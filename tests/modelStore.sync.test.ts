import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from '@/store/modelStore';
import { EXAMPLE_MODEL_SOURCE } from '@/model/example';
import { runModel } from '@/model/runtime';
import type { SceneNode } from '@/domain/cabinet/types';

const SOURCE = () => useModelStore.getState().source;
const RESULT = () => useModelStore.getState().result;

const resetStore = (source = EXAMPLE_MODEL_SOURCE) => {
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

// A tight source with three distinct cabinet calls, each with its own
// literals — exactly the shape required for per-instance editing to do
// what the user expects (no shared `param(...)` read, no loop).
const THREE_DISTINCT_CABINETS = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [2000, 0, 0] });
`;

describe('modelStore — per-instance setSelectionParam', () => {
  beforeEach(() => {
    resetStore(THREE_DISTINCT_CABINETS);
  });

  it('is a no-op when nothing is selected', () => {
    const before = SOURCE();
    useModelStore.getState().setSelectionParam('width', 1200);
    expect(SOURCE()).toBe(before);
  });

  it('edits only the selected cabinet, not its siblings', () => {
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(3);

    // Select cabinet #2 (the middle one).
    useModelStore.getState().select(cabinets[1].id);
    useModelStore.getState().setSelectionParam('width', 1200);

    const after = RESULT();
    const widths = after.nodes
      .filter((n) => n.type === 'cabinet')
      .map((c) => (c.type === 'cabinet' ? c.params.width : NaN));

    expect(widths).toEqual([800, 1200, 800]);
  });

  it('decouples a param() read into a literal at the selected call only', () => {
    const sharedParamSource =
      `api.cabinet({ width: param('width', 800), height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });\n` +
      `api.cabinet({ width: param('width', 800), height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0] });\n`;
    resetStore(sharedParamSource);

    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    useModelStore.getState().select(cabinets[0].id);
    useModelStore.getState().setSelectionParam('width', 1500);

    const out = SOURCE();
    // First cabinet now has a literal width; second still reads through the param.
    expect(out.split('\n')[0]).toContain('width: 1500');
    expect(out.split('\n')[0]).not.toContain('param(');
    expect(out.split('\n')[1]).toContain(`param('width', 800)`);
  });

  it('preserves the rest of the source verbatim', () => {
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    useModelStore.getState().select(cabinets[2].id);
    const before = SOURCE();
    useModelStore.getState().setSelectionParam('height', 2200);
    const after = SOURCE();
    // Only the third line's height literal should change.
    const lines = before.split('\n');
    const linesAfter = after.split('\n');
    expect(linesAfter[0]).toBe(lines[0]);
    expect(linesAfter[1]).toBe(lines[1]);
    expect(linesAfter[2]).toContain('height: 2200');
  });

  it('keeps the panel showing the new value after an edit', () => {
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    useModelStore.getState().select(cabinets[0].id);
    useModelStore.getState().setSelectionParam('width', 1000);

    const selectionId = useModelStore.getState().selection!;
    const node = findNode(RESULT().nodes, selectionId);
    expect(node?.type).toBe('cabinet');
    if (node?.type === 'cabinet') {
      expect(node.params.width).toBe(1000);
    }
  });

  it('the example source: editing one cabinet only affects that cabinet', () => {
    // The example is authored as three distinct `api.cabinet({...})` calls,
    // so each has its own source location and the panel can edit them
    // independently.
    resetStore(EXAMPLE_MODEL_SOURCE);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(3);

    useModelStore.getState().select(cabinets[1].id);
    useModelStore.getState().setSelectionParam('width', 1200);

    const widths = RESULT()
      .nodes.filter((n) => n.type === 'cabinet')
      .map((c) => (c.type === 'cabinet' ? c.params.width : NaN));
    expect(widths).toEqual([800, 1200, 800]);
  });

  it('shared source (loops): editing a looped call propagates to every iteration', () => {
    // Honest behaviour reminder: if the user writes a loop that produces
    // multiple cabinets from ONE source call, those cabinets all read the
    // same source location and a per-instance edit affects every iteration.
    // To get true per-instance control, callers must author distinct calls
    // (as the example above does).
    const looped =
      `for (let i = 0; i < 3; i++) {\n` +
      `  api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [i * 1000, 0, 0] });\n` +
      `}`;
    resetStore(looped);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(3);

    useModelStore.getState().select(cabinets[0].id);
    useModelStore.getState().setSelectionParam('width', 1200);

    const widths = RESULT()
      .nodes.filter((n) => n.type === 'cabinet')
      .map((c) => (c.type === 'cabinet' ? c.params.width : NaN));
    expect(widths).toEqual([1200, 1200, 1200]);
  });
});
