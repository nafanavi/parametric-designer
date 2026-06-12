import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock repair BEFORE importing the store so a Vitest hoist binds the spy.
const repairMock = vi.hoisted(() => vi.fn());
vi.mock('@/model/repair', () => ({ repairSource: repairMock }));

import { useModelStore } from '@/store/modelStore';
import { runModel } from '@/model/runtime';

const SELECTION = () => useModelStore.getState().selection;
const RESULT = () => useModelStore.getState().result;
const SOURCE = () => useModelStore.getState().source;

const resetStore = (source: string) => {
  useModelStore.setState({
    source,
    selection: null,
    result: runModel(source),
    isRepairing: false,
  });
};

/**
 * Three independent cabinets at distinct source positions, no shared params.
 * Used to verify that a selection survives mutations on OTHER cabinets.
 */
const THREE_CABINETS = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [2000, 0, 0] });
`;

describe('selection survives commits', () => {
  beforeEach(() => repairMock.mockReset());

  it('survives a param edit on the selected cabinet', async () => {
    resetStore(THREE_CABINETS);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    const middle = cabinets[1];
    useModelStore.getState().select(middle.id);
    expect(SELECTION()).toBe(middle.id);

    await useModelStore.getState().setSelectionParam('width', 1200);

    // The cabinet still exists at the same source start, so id is identical.
    expect(SELECTION()).toBe(middle.id);
    const after = RESULT().nodes.filter((n) => n.type === 'cabinet');
    expect(after[1].params.width).toBe(1200);
    expect(after[1].sourceRange?.start).toBe(middle.sourceRange?.start);
  });

  it('survives an unrelated append (action button) — id of selected is unchanged', () => {
    resetStore(THREE_CABINETS);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    const first = cabinets[0];
    useModelStore.getState().select(first.id);

    // Append a new cabinet AFTER the existing ones. The first cabinet's
    // sourceRange.start is at byte 0 and stays put — selection is invariant.
    useModelStore.getState().applyEdit({
      kind: 'append',
      code: `api.cabinet({ width: 600, height: 1800, depth: 400, thickness: 18, position: [3000, 0, 0] });\n`,
    });

    expect(SELECTION()).toBe(first.id);
    expect(RESULT().nodes.filter((n) => n.type === 'cabinet')).toHaveLength(4);
  });

  it('follows a global insert at the top — selection lands on the same conceptual cabinet', () => {
    // The delta-aware matcher tracks insertions that happen entirely BEFORE
    // the selected node: prevStart shifts by `(newEnd - oldEnd)` of the
    // edit. The middle cabinet's id changes (new start) but the matcher
    // points at the same conceptual cabinet — same source text after the
    // shift.
    resetStore(THREE_CABINETS);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    const middle = cabinets[1];
    useModelStore.getState().select(middle.id);
    const selectedText = SOURCE().slice(
      middle.sourceRange!.start,
      middle.sourceRange!.end,
    );

    const COMMENT = `// fresh note\n`;
    useModelStore.getState().setSource(COMMENT + THREE_CABINETS);

    const newSel = SELECTION();
    expect(newSel).not.toBeNull();
    const after = RESULT().nodes.filter((n) => n.type === 'cabinet');
    const node = after.find((n) => n.id === newSel)!;
    // Same conceptual cabinet — its call text is unchanged.
    expect(SOURCE().slice(node.sourceRange!.start, node.sourceRange!.end)).toBe(selectedText);
  });

  it('clears the selection when deleteSelection commits', async () => {
    resetStore(THREE_CABINETS);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    useModelStore.getState().select(cabinets[1].id);

    await useModelStore.getState().deleteSelection();

    // deleteSelection passes { selection: null } as the explicit override —
    // that beats the re-resolve.
    expect(SELECTION()).toBeNull();
    expect(RESULT().nodes.filter((n) => n.type === 'cabinet')).toHaveLength(2);
  });

  // Regression: deleting a child of cabinet A caused the selection on a
  // child of cabinet B to "drift" — every node in B shifted earlier by the
  // deleted child's size, and the re-resolve was matching by absolute
  // start, so it landed on whatever node now occupied the old offset.
  it('does NOT drift when an earlier sibling`s child is deleted', async () => {
    const SOURCE_TWO_CABS = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [0, 0, 0], children: [
  api.shelf({ y: 459 }),
  api.shelf({ y: 900 }),
  api.shelf({ y: 1341 }),
] });
api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18, position: [1000, 0, 0], children: [
  api.shelf({ y: 459 }),
  api.shelf({ y: 900 }),
  api.shelf({ y: 1341 }),
] });
`;
    resetStore(SOURCE_TWO_CABS);
    const cabinets = RESULT().nodes.filter((n) => n.type === 'cabinet');
    expect(cabinets).toHaveLength(2);
    const bChildren = cabinets[1].children.filter((c) => c.type === 'shelf');
    expect(bChildren).toHaveLength(3);

    // Select the MIDDLE shelf of cabinet B (the second one).
    const selectedShelfB = bChildren[1];
    const selectedSourceText = SOURCE().slice(
      selectedShelfB.sourceRange!.start,
      selectedShelfB.sourceRange!.end,
    );
    useModelStore.getState().select(selectedShelfB.id);
    expect(SELECTION()).toBe(selectedShelfB.id);

    // Delete the FIRST shelf of cabinet A. This is the user's scenario.
    const aShelves = cabinets[0].children.filter((c) => c.type === 'shelf');
    useModelStore.getState().select(aShelves[0].id);
    await useModelStore.getState().deleteSelection();
    // Sanity: cabinet A lost one shelf.
    const afterA = RESULT().nodes[0];
    expect(afterA.children.filter((c) => c.type === 'shelf')).toHaveLength(2);

    // Now reselect the shelf in B and edit its width — we need to assert
    // selection STAYS on the originally-selected B shelf even after the
    // earlier delete shifted source positions.
    // Restart: do it the way the user actually does it (select first, then delete A's shelf).
    resetStore(SOURCE_TWO_CABS);
    const cabs2 = RESULT().nodes.filter((n) => n.type === 'cabinet');
    const bShelf2 = cabs2[1].children.filter((c) => c.type === 'shelf')[1];
    useModelStore.getState().select(bShelf2.id);

    // Now delete A's first shelf via deleteSelection — but deleteSelection
    // consumes `get().selection`, so we need to set it to A's shelf first,
    // remember the user's selection, delete, then re-resolve manually. The
    // semantically correct path is: route the deletion through commitSource
    // directly via `applyEdit` (a "replace" that removes the shelf line).
    const aShelf2 = cabs2[0].children.filter((c) => c.type === 'shelf')[0];
    const aShelfRange = aShelf2.sourceRange!;
    const lineStart = (() => {
      let i = aShelfRange.start;
      while (i > 0 && SOURCE()[i - 1] !== '\n') i--;
      return i;
    })();
    const lineEnd = (() => {
      let i = aShelfRange.end;
      while (i < SOURCE().length && SOURCE()[i] !== '\n') i++;
      return i + 1; // consume the trailing newline
    })();
    const newSource = SOURCE().slice(0, lineStart) + SOURCE().slice(lineEnd);
    useModelStore.getState().setSource(newSource);

    // The selection should still point at the SAME B shelf — the matcher
    // shifts the expected position by the deletion's size delta.
    const newSel = SELECTION();
    expect(newSel).not.toBeNull();
    // The new selection's text must match what we originally selected.
    const newSelNode = (() => {
      for (const cab of RESULT().nodes) {
        for (const c of cab.children) if (c.id === newSel) return c;
      }
      return null;
    })();
    expect(newSelNode).not.toBeNull();
    const newSelText = SOURCE().slice(
      newSelNode!.sourceRange!.start,
      newSelNode!.sourceRange!.end,
    );
    expect(newSelText).toBe(selectedSourceText);
    // And it lives under the SECOND cabinet.
    expect(newSelNode!.parentId).toBe(RESULT().nodes[1].id);
  });

});
