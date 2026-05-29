import { describe, it, expect } from 'vitest';
import { runModel } from '@/model/runtime';
import { EXAMPLE_MODEL_SOURCE } from '@/model/example';
import { SceneQuery } from '@/model/scene/query';

const result = runModel(EXAMPLE_MODEL_SOURCE);
const q = new SceneQuery(result);

describe('SceneQuery — listing', () => {
  it('finds the 3 cabinets the example creates', () => {
    const cabinets = q.listAll('cabinet');
    expect(cabinets).toHaveLength(3);
    expect(cabinets.every((c) => c.type === 'cabinet')).toBe(true);
  });

  it('lists every panel (5 per cabinet × 3 cabinets)', () => {
    expect(q.listAll('panel')).toHaveLength(15);
  });

  it('listAll() with no filter returns all nodes', () => {
    const all = q.listAll();
    // 3 cabinets + 5 panels + 3 shelves + 2 doors per cabinet = 3 + 30 = 33
    expect(all.length).toBeGreaterThanOrEqual(33);
    const types = new Set(all.map((n) => n.type));
    expect(types).toEqual(new Set(['cabinet', 'panel', 'shelf', 'door']));
  });
});

describe('SceneQuery — summarize', () => {
  it('returns a fully populated NodeSummary for a known cabinet', () => {
    const first = q.listAll('cabinet')[0];
    const summary = q.summarize(first.id);
    expect(summary).not.toBeNull();
    expect(summary!.type).toBe('cabinet');
    expect(summary!.callIndex).toBeGreaterThan(0);
    expect(summary!.aabb.min).toHaveLength(3);
    expect(summary!.aabb.max).toHaveLength(3);
    expect(summary!.center).toHaveLength(3);
    expect(summary!.size).toHaveLength(3);
  });

  it('returns null for an unknown id', () => {
    expect(q.getNode('does-not-exist')).toBeNull();
    expect(q.summarize('does-not-exist')).toBeNull();
  });

  it('cabinet AABB has the right width and height (doors extend depth past 400)', () => {
    const cabinet = q.summarize(q.listAll('cabinet')[0].id)!;
    expect(cabinet.size[0]).toBeCloseTo(800, 0);
    expect(cabinet.size[1]).toBeCloseTo(1800, 0);
    // Depth includes the door panel mounted on the front face (d/2 + t/2 + t/2 = 418).
    expect(cabinet.size[2]).toBeGreaterThan(400);
  });
});

describe('SceneQuery — parents and aggregation', () => {
  it('parent(panel) returns the owning cabinet', () => {
    const panel = q.listAll('panel')[0];
    const parentId = q.parent(panel.id);
    expect(parentId).not.toBeNull();
    expect(q.getNode(parentId!)?.type).toBe('cabinet');
  });

  it('cabinet AABB encloses every child panel/shelf/door', () => {
    const cabinet = q.summarize(q.listAll('cabinet')[0].id)!;
    const children = q
      .listAll()
      .filter((n) => q.parent(n.id) === cabinet.id);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      for (let axis = 0; axis < 3; axis++) {
        expect(child.aabb.min[axis]).toBeGreaterThanOrEqual(cabinet.aabb.min[axis] - 0.01);
        expect(child.aabb.max[axis]).toBeLessThanOrEqual(cabinet.aabb.max[axis] + 0.01);
      }
    }
  });
});

describe('SceneQuery — neighbors', () => {
  it('finds the next cabinet to the right with ~200mm gap', () => {
    const cabinets = q.listAll('cabinet').sort((a, b) => a.center[0] - b.center[0]);
    const first = cabinets[0];
    const second = cabinets[1];

    const neighborsOfFirst = q.neighbors(first.id);
    const found = neighborsOfFirst.find(
      (n) => n.nodeId === second.id && n.axis === 'x' && n.side === 'max',
    );
    expect(found).toBeDefined();
    expect(found!.gapMm).toBeCloseTo(200, 0);
  });

  it('returns neighbors sorted by gap (closest first)', () => {
    const first = q.listAll('cabinet').sort((a, b) => a.center[0] - b.center[0])[0];
    const neighbors = q.neighbors(first.id);
    for (let i = 1; i < neighbors.length; i++) {
      expect(neighbors[i].gapMm).toBeGreaterThanOrEqual(neighbors[i - 1].gapMm);
    }
  });

  it('returns empty array for an unknown id', () => {
    expect(q.neighbors('nope')).toEqual([]);
  });
});
