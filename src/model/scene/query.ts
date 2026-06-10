import type { RunResult } from '@/model/runtime';
import type { SceneNode } from '@/domain/cabinet/types';
import type { AABB, SolidId, Vec3 } from '@/core/types';
import type { SourceRange } from '@/model/ast/types';

export interface NodeSummary {
  readonly id: string;
  readonly type: SceneNode['type'];
  readonly callIndex: number;
  /** Byte offsets `[start, end)` of the originating `api.X(...)` call in source. */
  readonly sourceRange: SourceRange | null;
  readonly parentId: string | null;
  readonly params: Record<string, unknown>;
  readonly aabb: AABB;
  readonly center: Vec3;
  readonly size: Vec3;
}

export interface NeighborInfo {
  readonly nodeId: string;
  readonly type: SceneNode['type'];
  readonly axis: 'x' | 'y' | 'z';
  /** 'min' = the other node is on this node's smaller-coordinate side; 'max' = larger. */
  readonly side: 'min' | 'max';
  /** Distance along the axis. Negative = AABBs overlap on this axis. */
  readonly gapMm: number;
}

/** How far to scan for "neighbors" along an axis. Tight enough that a single
 *  cabinet's panels see each other; loose enough that adjacent cabinets do too. */
const MAX_NEIGHBOR_DISTANCE_MM = 1500;
const OVERLAP_TOLERANCE_MM = 0.5;

/**
 * Read-only query layer over a `RunResult`. Builds parent + id maps once and
 * aggregates SolidId AABBs from the kernel. Used by the LLM-tools layer in
 * `src/model/llm/tools.ts`, but also fine to use anywhere we need to inspect
 * the current scene.
 *
 * Coordinates are in millimetres throughout — same as the model authoring
 * convention.
 *
 * `queryOf(result)` (below) memoises one SceneQuery per `RunResult` so
 * repeated callers (the store on every keystroke, the viewport on every
 * render) don't re-walk the tree.
 */
export class SceneQuery {
  private readonly byId = new Map<string, SceneNode>();
  private readonly aabbCache = new Map<string, AABB>();

  constructor(private readonly result: RunResult) {
    const walk = (nodes: readonly SceneNode[]) => {
      for (const n of nodes) {
        this.byId.set(n.id, n);
        if (n.children.length) walk(n.children);
      }
    };
    walk(result.nodes);
  }

  getNode(id: string): SceneNode | null {
    return this.byId.get(id) ?? null;
  }

  /** Every id in this run, in insertion (tree-walk) order. Used by the
   *  store's selection re-resolve pass to find a node by sourceRange. */
  allIds(): IterableIterator<string> {
    return this.byId.keys();
  }

  parent(id: string): string | null {
    return this.byId.get(id)?.parentId ?? null;
  }

  summarize(id: string): NodeSummary | null {
    const node = this.byId.get(id);
    if (!node) return null;
    const aabb = this.aabbOf(id);
    return {
      id: node.id,
      type: node.type,
      callIndex: node.callIndex,
      sourceRange: node.sourceRange ?? null,
      parentId: node.parentId,
      params: node.params as unknown as Record<string, unknown>,
      aabb,
      center: centerOf(aabb),
      size: sizeOf(aabb),
    };
  }

  listAll(filterType?: string): NodeSummary[] {
    const out: NodeSummary[] = [];
    for (const id of this.byId.keys()) {
      const s = this.summarize(id);
      if (!s) continue;
      if (filterType && s.type !== filterType) continue;
      out.push(s);
    }
    return out;
  }

  /**
   * Returns nodes whose AABB perpendicular-projection overlaps this node's
   * along two axes, ranked by closeness along the third. Useful for "the
   * panel above", "the back shelf", "the next cabinet to the right".
   *
   * For every other node, decides which axis is the *separating axis* (the
   * one with the largest signed distance between AABBs) and reports
   * direction + gap on that axis. Negative gap means the AABBs overlap on
   * the separating axis too.
   */
  neighbors(id: string): NeighborInfo[] {
    const self = this.byId.get(id);
    if (!self) return [];
    const a = this.aabbOf(id);

    const out: NeighborInfo[] = [];
    for (const other of this.byId.values()) {
      if (other.id === id) continue;
      const b = this.aabbOf(other.id);
      const rel = relativePosition(a, b);
      if (!rel) continue;
      if (rel.gap > MAX_NEIGHBOR_DISTANCE_MM) continue;
      out.push({
        nodeId: other.id,
        type: other.type,
        axis: rel.axis,
        side: rel.side,
        gapMm: rel.gap,
      });
    }
    out.sort((x, y) => x.gapMm - y.gapMm);
    return out;
  }

  /** Bounding box of a node, computed as the union of its (and children's) solid AABBs. */
  aabbOf(id: string): AABB {
    const cached = this.aabbCache.get(id);
    if (cached) return cached;
    const node = this.byId.get(id);
    if (!node) return EMPTY_AABB;
    const aabb = unionAABB(this.collectSolidAABBs(node));
    this.aabbCache.set(id, aabb);
    return aabb;
  }

  private collectSolidAABBs(node: SceneNode): AABB[] {
    const out: AABB[] = [];
    for (const sid of node.solids) {
      out.push(this.result.core.snapshot(sid).aabb);
    }
    for (const child of node.children) {
      // children's solids are already aggregated into parent.solids in our
      // current DomainAPI, but recursing makes the query robust if a future
      // domain stops doing that aggregation.
      for (const a of this.collectSolidAABBs(child)) out.push(a);
    }
    return out;
  }
}

// ───────────────────────────── helpers ─────────────────────────────

const EMPTY_AABB: AABB = { min: [0, 0, 0], max: [0, 0, 0] };

function centerOf(a: AABB): Vec3 {
  return [
    (a.min[0] + a.max[0]) / 2,
    (a.min[1] + a.max[1]) / 2,
    (a.min[2] + a.max[2]) / 2,
  ];
}

function sizeOf(a: AABB): Vec3 {
  return [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]];
}

function unionAABB(boxes: readonly AABB[]): AABB {
  if (boxes.length === 0) return EMPTY_AABB;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      if (b.min[i] < min[i]) min[i] = b.min[i];
      if (b.max[i] > max[i]) max[i] = b.max[i];
    }
  }
  return { min, max };
}

/**
 * Returns relative direction info if `b` perpendicular-overlaps `a` on two
 * axes and is separable on the third. Picks the axis with the largest
 * signed gap as the "separating axis". Null if `b` doesn't share any
 * perpendicular projection with `a` (it's diagonally offset).
 */
function relativePosition(a: AABB, b: AABB):
  | { axis: 'x' | 'y' | 'z'; side: 'min' | 'max'; gap: number }
  | null {
  const axes = ['x', 'y', 'z'] as const;
  let bestAxis = -1;
  let bestSide: 'min' | 'max' = 'max';
  let bestGap = -Infinity;

  for (let i = 0; i < 3; i++) {
    const gapMax = a.min[i] - b.max[i]; // b on the 'min' side of a
    const gapMin = b.min[i] - a.max[i]; // b on the 'max' side of a
    const side: 'min' | 'max' = gapMax > gapMin ? 'min' : 'max';
    const gap = side === 'min' ? gapMax : gapMin;
    if (gap > bestGap) {
      bestGap = gap;
      bestAxis = i;
      bestSide = side;
    }
  }

  // Require perpendicular overlap on the other two axes.
  const o1 = (bestAxis + 1) % 3;
  const o2 = (bestAxis + 2) % 3;
  if (!perpOverlap(a, b, o1) || !perpOverlap(a, b, o2)) return null;

  return { axis: axes[bestAxis], side: bestSide, gap: bestGap };
}

function perpOverlap(a: AABB, b: AABB, axis: number): boolean {
  return a.min[axis] < b.max[axis] - OVERLAP_TOLERANCE_MM
    && a.max[axis] > b.min[axis] + OVERLAP_TOLERANCE_MM;
}

/**
 * Memoised `SceneQuery` factory keyed on `RunResult` identity. A given
 * `RunResult` builds its query once and reuses it for every subsequent
 * caller — store actions, viewport renders, LLM tools — until that
 * `RunResult` is replaced by the next `runModel(...)`. Old `RunResult`s
 * are GC'd along with their cached queries (WeakMap).
 */
const queryCache = new WeakMap<RunResult, SceneQuery>();

export function queryOf(result: RunResult): SceneQuery {
  let q = queryCache.get(result);
  if (!q) {
    q = new SceneQuery(result);
    queryCache.set(result, q);
  }
  return q;
}

// re-export SolidId type-only for callers needing it alongside this module
export type { SolidId };
