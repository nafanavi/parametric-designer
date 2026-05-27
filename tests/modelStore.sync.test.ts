import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from '@/store/modelStore';
import { EXAMPLE_MODEL_SOURCE } from '@/model/example';
import { runModel } from '@/model/runtime';

const PANEL_VALUE = (name: string) =>
  useModelStore.getState().result.params.get(name)?.value;

const SOURCE = () => useModelStore.getState().source;

const resetStore = (source = EXAMPLE_MODEL_SOURCE) => {
  useModelStore.setState({
    source,
    selection: null,
    result: runModel(source),
  });
};

describe('modelStore — source ⇄ parameters panel sync', () => {
  beforeEach(() => {
    resetStore();
  });

  it('panel reads its initial values from the source defaults', () => {
    expect(PANEL_VALUE('width')).toBe(800);
    expect(PANEL_VALUE('height')).toBe(1800);
    expect(PANEL_VALUE('shelves')).toBe(3);
  });

  it('setParam from the panel rewrites the literal in the source', () => {
    useModelStore.getState().setParam('width', 1200);

    expect(SOURCE()).toContain(`param('width', 1200)`);
    expect(SOURCE()).not.toContain(`param('width', 800)`);
    expect(PANEL_VALUE('width')).toBe(1200);
  });

  it('editing the source updates the panel value (reverse direction)', () => {
    const edited = EXAMPLE_MODEL_SOURCE.replace(
      `param('width', 800)`,
      `param('width', 1500)`,
    );
    useModelStore.getState().setSource(edited);

    expect(PANEL_VALUE('width')).toBe(1500);
  });

  it('setParam preserves the rest of the source verbatim', () => {
    const before = SOURCE();
    useModelStore.getState().setParam('height', 2000);
    const after = SOURCE();

    // Only the height default should change; the rest of the source is intact.
    expect(after.replace(`param('height', 2000)`, `param('height', 1800)`)).toBe(before);
  });

  it('setParam is a no-op when the param has a non-literal default', () => {
    const computed = `api.cabinet({\n  width: param('width', 800 + 0),\n  height: 1000, depth: 400, thickness: 18, shelves: 1, doors: 0,\n});\n`;
    resetStore(computed);

    const before = SOURCE();
    useModelStore.getState().setParam('width', 1200);
    expect(SOURCE()).toBe(before);
  });

  it('setParam is a no-op when the named param is absent', () => {
    const before = SOURCE();
    useModelStore.getState().setParam('doesNotExist', 42);
    expect(SOURCE()).toBe(before);
  });

  it('round-trip: changing width via panel updates the rendered scene parameters', () => {
    useModelStore.getState().setParam('width', 1000);

    const cabinet = useModelStore
      .getState()
      .result.nodes.find((n) => n.type === 'cabinet');
    expect(cabinet?.type).toBe('cabinet');
    if (cabinet?.type === 'cabinet') {
      expect(cabinet.params.width).toBe(1000);
    }
  });

  it('multiple sequential edits remain consistent between source and panel', () => {
    useModelStore.getState().setParam('width', 1000);
    useModelStore.getState().setParam('height', 2200);
    useModelStore.getState().setParam('shelves', 5);

    expect(PANEL_VALUE('width')).toBe(1000);
    expect(PANEL_VALUE('height')).toBe(2200);
    expect(PANEL_VALUE('shelves')).toBe(5);

    expect(SOURCE()).toContain(`param('width', 1000)`);
    expect(SOURCE()).toContain(`param('height', 2200)`);
    expect(SOURCE()).toContain(`param('shelves', 5)`);
  });
});
