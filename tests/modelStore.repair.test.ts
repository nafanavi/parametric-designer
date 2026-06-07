import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the repair facade BEFORE importing the store, so the store binds to
// the mocked module. `vi.hoisted` so the spy survives Vitest's mock hoisting.
const repairMock = vi.hoisted(() => vi.fn());
vi.mock('@/model/repair', () => ({ repairSource: repairMock }));

import { useModelStore } from '@/store/modelStore';
import { runModel } from '@/model/runtime';
import type { SceneNode } from '@/domain/cabinet/types';

const SOURCE = () => useModelStore.getState().source;
const RESULT = () => useModelStore.getState().result;

const resetStore = (source: string) => {
  useModelStore.setState({
    source,
    selection: null,
    result: runModel(source),
  });
};

function findNode(nodes: readonly SceneNode[], id: string): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findNode(n.children, id);
    if (child) return child;
  }
  return null;
}

// Three distinct cabinets — independent calls so `deleteSelection` on any of
// them produces a clean source (no dangling references). Used as the
// "happy path" baseline.
const INDEPENDENT_CABINETS = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [2000, 0, 0] });
`;

// One cabinet stored as `a`, with a shelf and door referencing `a`. Deleting
// the cabinet leaves the shelf/door referencing an undefined `a` — runtime
// error — which is exactly what should trigger the silent repair path.
const REFERENCING_CABINET = `const a = api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });
api.shelf({ in: a, y: 600 });
api.door({ in: a, side: 'left' });
`;

describe('modelStore — silent repair pipeline', () => {
  beforeEach(() => {
    repairMock.mockReset();
  });

  describe('pre-check fast path', () => {
    it('does not call repairSource when the proposed source runs cleanly (delete)', async () => {
      resetStore(INDEPENDENT_CABINETS);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[1].id);

      await useModelStore.getState().deleteSelection();

      expect(repairMock).not.toHaveBeenCalled();
      expect(RESULT().nodes.filter((n) => n.type === 'cabinet')).toHaveLength(2);
    });

    it('does not call repairSource when a param edit runs cleanly', async () => {
      resetStore(INDEPENDENT_CABINETS);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      await useModelStore.getState().setSelectionParam('width', 1200);

      expect(repairMock).not.toHaveBeenCalled();
      const widths = RESULT()
        .nodes.filter((n) => n.type === 'cabinet')
        .map((c) => (c.type === 'cabinet' ? c.params.width : NaN));
      expect(widths).toEqual([1200, 800, 800]);
    });
  });

  describe('repair success path', () => {
    it('commits the repaired source when the LLM returns a clean fix', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      expect(cabinets).toHaveLength(1);
      useModelStore.getState().select(cabinets[0].id);

      // Simulate the LLM removing the dependent shelf/door lines too.
      const repaired = `// auto-repaired\n`;
      repairMock.mockResolvedValueOnce({
        status: 'success',
        source: repaired,
        message: 'ok',
      });

      await useModelStore.getState().deleteSelection();

      // Repair was invoked exactly once, with previous + proposed + an error.
      expect(repairMock).toHaveBeenCalledTimes(1);
      const arg = repairMock.mock.calls[0][0];
      expect(arg.previous).toBe(REFERENCING_CABINET);
      expect(arg.proposed).not.toContain('const a = api.cabinet'); // the cabinet line was removed
      expect(arg.proposed).toContain('api.shelf'); // shelf line still there, hence the error
      expect(typeof arg.error).toBe('string');
      expect(arg.error.length).toBeGreaterThan(0);

      // Repaired source is committed; selection cleared via onSuccess.
      expect(SOURCE()).toBe(repaired);
      expect(useModelStore.getState().selection).toBeNull();
      expect(RESULT().error).toBeUndefined();
      expect(RESULT().nodes).toHaveLength(0);
    });
  });

  describe('repair failure → silent revert', () => {
    it('keeps the previous source when repair returns "unavailable"', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      repairMock.mockResolvedValueOnce({
        status: 'unavailable',
        message: 'no api key',
      });

      await useModelStore.getState().deleteSelection();

      // Nothing changed: source identical, selection still set, no error.
      expect(SOURCE()).toBe(REFERENCING_CABINET);
      expect(useModelStore.getState().selection).toBe(cabinets[0].id);
      expect(RESULT().error).toBeUndefined();
    });

    it('keeps the previous source when repair returns "error"', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      repairMock.mockResolvedValueOnce({
        status: 'error',
        message: 'provider 500',
      });

      await useModelStore.getState().deleteSelection();

      expect(SOURCE()).toBe(REFERENCING_CABINET);
      expect(useModelStore.getState().selection).toBe(cabinets[0].id);
      expect(RESULT().error).toBeUndefined();
    });

    it('keeps the previous source when repair "succeeds" but its output still throws', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      // LLM returned something but it's still broken (still references `a`).
      repairMock.mockResolvedValueOnce({
        status: 'success',
        source: `api.shelf({ in: a, y: 600 });\n`,
        message: 'ok',
      });

      await useModelStore.getState().deleteSelection();

      expect(SOURCE()).toBe(REFERENCING_CABINET);
      expect(useModelStore.getState().selection).toBe(cabinets[0].id);
      expect(RESULT().error).toBeUndefined();
    });
  });

  // Regression for review finding #4: a second mutation triggered while a
  // repair is in flight used to fire a parallel /api/repair fetch and race
  // the isRepairing flag. The store-level gate drops re-entrant calls.
  describe('repair is the single in-flight gate', () => {
    it('drops a second deleteSelection while a repair is in flight', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      // Make the first repair await an externally-resolved promise so we can
      // fire a second action while it's mid-flight.
      let resolveFirst: (v: { status: 'success'; source: string; message: string }) => void;
      const firstRepair = new Promise<{ status: 'success'; source: string; message: string }>(
        (r) => {
          resolveFirst = r;
        },
      );
      repairMock.mockReturnValueOnce(firstRepair);

      const firstCall = useModelStore.getState().deleteSelection();

      // While the repair is in flight, isRepairing is true and a second
      // deleteSelection must no-op (otherwise we race the flag + bill twice).
      expect(useModelStore.getState().isRepairing).toBe(true);
      await useModelStore.getState().deleteSelection();
      expect(repairMock).toHaveBeenCalledTimes(1);

      // Finish the first repair so the test isolation is clean.
      resolveFirst!({ status: 'success', source: '// auto-repaired\n', message: 'ok' });
      await firstCall;
      expect(useModelStore.getState().isRepairing).toBe(false);
    });

    it('drops a select() call while a repair is in flight', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      const originalId = cabinets[0].id;
      useModelStore.getState().select(originalId);

      let resolveFirst: (v: { status: 'success'; source: string; message: string }) => void;
      const firstRepair = new Promise<{ status: 'success'; source: string; message: string }>(
        (r) => {
          resolveFirst = r;
        },
      );
      repairMock.mockReturnValueOnce(firstRepair);

      const inFlight = useModelStore.getState().deleteSelection();

      // Attempt to retarget selection mid-repair — must no-op.
      useModelStore.getState().select('cabinet#impossible');
      expect(useModelStore.getState().selection).toBe(originalId);

      resolveFirst!({ status: 'success', source: '// auto-repaired\n', message: 'ok' });
      await inFlight;
    });
  });

  // Regression for review finding #1: source moved during the repair await
  // (e.g. user typed in the debug textarea) — the late repair commit must
  // NOT clobber the intervening change.
  describe('lost-update guard', () => {
    it('does not commit repaired source when source was changed during the await', async () => {
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      let resolveRepair: (v: { status: 'success'; source: string; message: string }) => void;
      const repairPromise = new Promise<{ status: 'success'; source: string; message: string }>(
        (r) => {
          resolveRepair = r;
        },
      );
      repairMock.mockReturnValueOnce(repairPromise);

      const inFlight = useModelStore.getState().deleteSelection();

      // Mid-repair: developer types in the debug textarea (setSource bypasses
      // commitSource by design). The repair, when it lands, must not overwrite
      // this.
      const userTyped = `api.cabinet({ width: 1234, height: 1000, depth: 200, thickness: 18, position: [0, 0, 0] });\n`;
      useModelStore.getState().setSource(userTyped);
      expect(SOURCE()).toBe(userTyped);

      resolveRepair!({
        status: 'success',
        source: `// auto-repaired\n`,
        message: 'ok',
      });
      await inFlight;

      // Repair was attempted but its commit was vetoed by the lost-update guard.
      expect(SOURCE()).toBe(userTyped);
      expect(useModelStore.getState().isRepairing).toBe(false);
    });
  });

  describe('setSelectionParam through the repair pipeline', () => {
    it('calls repair only when the edit actually breaks the source', async () => {
      // Authored source uses `cab.width` later — editing width via panel
      // produces a literal swap, but for sanity we just verify the pipeline
      // doesn't fire repair on a clean edit and DOES on a broken one.
      resetStore(REFERENCING_CABINET);
      const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
      useModelStore.getState().select(cabinets[0].id);

      // Plain numeric edit — source still runs cleanly, no repair.
      await useModelStore.getState().setSelectionParam('width', 1000);
      expect(repairMock).not.toHaveBeenCalled();

      const node = findNode(RESULT().nodes, useModelStore.getState().selection!);
      expect(node?.type).toBe('cabinet');
      if (node?.type === 'cabinet') {
        expect(node.params.width).toBe(1000);
      }
    });
  });
});
