import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';
import { ModelEvaluationSession } from '@/model/runtime/session';
import {
  promoteToConceptualOwner,
  reresolveSelection,
} from '@/model/runtime/selection';

/**
 * Identity is anchored to `sourceRange.start` for instrumented runs, falls
 * back to a runtime counter for direct (uninstrumented) API use, and the
 * store's click path promotes "internal" children (frame panels of a
 * cabinet) up to the conceptual owner.
 */

describe('id format', () => {
  it('uses sourceRange.start for instrumented runs', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const result = runModel(src);
    expect(result.error).toBeUndefined();
    const cab = result.nodes[0];
    // `api.cabinet({...})` starts at byte 0.
    expect(cab.id).toBe(`cabinet@${cab.sourceRange!.start}`);
    expect(cab.sourceRange!.start).toBe(0);
  });

  it('frame panels carry the cabinet`s start + their side label', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const result = runModel(src);
    const cab = result.nodes[0];
    const sides = cab.children.filter((c) => c.type === 'panel');
    expect(sides).toHaveLength(5);
    const expectedSides = ['left', 'right', 'top', 'bottom', 'back'];
    for (const side of expectedSides) {
      const match = sides.find((p) => p.id.endsWith(`:${side}`));
      expect(match).toBeDefined();
      expect(match!.id).toBe(`panel@${cab.sourceRange!.start}:${side}`);
    }
  });

  it('falls back to `${type}#${counter}` for uninstrumented (direct) API use', () => {
    // Create a session and use its api directly — no __withLoc → no sourceRange.
    const session = new ModelEvaluationSession();
    const cab = session.api.cabinet({
      width: 800, height: 1800, depth: 400, thickness: 18,
    });
    expect(cab.sourceRange).toBeUndefined();
    expect(cab.id).toMatch(/^cabinet#\d+$/);
  });
});

describe('promoteToConceptualOwner', () => {
  it('promotes a frame-panel click up to the owning cabinet', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const result = runModel(src);
    const cab = result.nodes[0];
    const leftPanel = cab.children.find((c) => c.id.endsWith(':left'))!;
    expect(promoteToConceptualOwner(leftPanel.id, result)).toBe(cab.id);
  });

  it('does NOT promote a nested shelf — it has its own sourceRange', () => {
    const src = `api.cabinet({
      width: 800, height: 1800, depth: 400, thickness: 18,
      children: [ api.shelf({ y: 600 }) ],
    });`;
    const result = runModel(src);
    const cab = result.nodes[0];
    const shelf = cab.children.find((c) => c.type === 'shelf')!;
    expect(promoteToConceptualOwner(shelf.id, result)).toBe(shelf.id);
  });

  it('returns the clicked id unchanged for top-level nodes', () => {
    const src = `api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`;
    const result = runModel(src);
    const cab = result.nodes[0];
    expect(promoteToConceptualOwner(cab.id, result)).toBe(cab.id);
  });
});

describe('reresolveSelection', () => {
  it('returns the same id when the selected node`s source position is unchanged', () => {
    const before = runModel(`api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`);
    const cab = before.nodes[0];

    // Same source structure, different param value — start stays at 0.
    const after = runModel(`api.cabinet({ width: 900, height: 1800, depth: 400, thickness: 18 });`);
    expect(reresolveSelection(cab, after)).toBe(cab.id);
  });

  it('returns null when the previous selection has no sourceRange', () => {
    const session = new ModelEvaluationSession();
    const cab = session.api.cabinet({
      width: 800, height: 1800, depth: 400, thickness: 18,
    });
    const after = runModel(`api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`);
    expect(reresolveSelection(cab, after)).toBeNull();
  });

  it('falls back to containment when no exact-start match exists', () => {
    // Before: one bare cabinet at start=0.
    const before = runModel(`api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });`);
    const cab = before.nodes[0];

    // After: the same cabinet wrapped in a function — the call starts later,
    // so no exact-start match. Containment: the function declaration's
    // ExpressionStatement contains the old start? No — only nodes with
    // sourceRange participate. The new api.cabinet call is at a non-zero
    // start, and no other node brackets start=0 either, so result is null.
    // (Containment fallback is most useful for wrap-in-LLM-rewrite cases.)
    const after = runModel(`function build() {\n  api.cabinet({ width: 800, height: 1800, depth: 400, thickness: 18 });\n}\nbuild();`);
    const out = reresolveSelection(cab, after);
    // The new api.cabinet's start is non-zero, and start=0 isn't bracketed by any node's range.
    expect(out).toBeNull();
  });
});
