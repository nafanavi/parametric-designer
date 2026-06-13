import type { RunResult } from '@/model/runtime';
import type { SceneNode } from '@/domain/cabinet/types';
import type { AABB, Mat4, SolidId, Transform, Vec3 } from '@/core/types';
import type { SourceRange } from '@/model/ast/types';
import {
  IDENTITY_MAT4,
  compose,
  fromMat4,
  toMat4,
  transformPoint,
} from '@/core/math/transform';

export interface NodeSummary {
  readonly id: string;
  readonly type: SceneNode['type'];
  readonly callIndex: number;
  /** Byte offsets `[start, end)` of the originating `api.X(...)` call in source. */
  readonly sourceRange: SourceRange | null;
  readonly parentId: string | null;
  readonly params: Record<string, unknown>;
  /** World-space axis-aligned bounding box. */
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
 * derives world transforms (and world AABBs) by composing the chain from
 * each node up to the root. Used by the LLM-tools layer in
 * `src/model/llm/tools.ts`, drag math in `src/viewer/dragController.ts`,
 * and the viewport overlay (spinner anchor).
 *
 * Frames of reference: each `SceneNode.params.position` and `params.rotation`
 * is **local to the node's parent**. World transforms are derived here by
 * walking the parent chain and multiplying matrices. The kernel stores
 * solids in node-local coords; this layer composes them into world coords.
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
  private readonly worldMat4Cache = new Map<string, Mat4>();

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

  /**
   * World transform of a node — composes parent.localTransform ∘ … ∘
   * node.localTransform from root downward. Returned as a `Transform` for
   * consumers that want translation/rotation directly; use `worldMat4(id)`
   * when you need the matrix (e.g. to apply to local points).
   */
  worldTransform(id: string): Transform {
    return fromMat4(this.worldMat4(id));
  }

  /**
   * Projects a world-space point into the node's local frame. Inverts the
   * node's world matrix and applies it. Useful for adoption math and for
   * reading "where, in this cabinet's local coordinates, did the drop land?".
   */
  worldToLocal(id: string, worldPoint: Vec3): Vec3 {
    const w = this.worldMat4(id);
    // Rigid inverse: R^T and -R^T t.
    const r00 = w[0], r10 = w[1], r20 = w[2];
    const r01 = w[4], r11 = w[5], r21 = w[6];
    const r02 = w[8], r12 = w[9], r22 = w[10];
    const tx = w[12], ty = w[13], tz = w[14];
    const dx = worldPoint[0] - tx;
    const dy = worldPoint[1] - ty;
    const dz = worldPoint[2] - tz;
    return [
      r00 * dx + r10 * dy + r20 * dz,
      r01 * dx + r11 * dy + r21 * dz,
      r02 * dx + r12 * dy + r22 * dz,
    ];
  }

  worldMat4(id: string): Mat4 {
    const cached = this.worldMat4Cache.get(id);
    if (cached) return cached;
    const node = this.byId.get(id);
    if (!node) return IDENTITY_MAT4;
    const localMat = toMat4({
      translation: getPosition(node),
      rotation: getRotation(node),
    });
    const parentId = node.parentId;
    const worldMat = parentId
      ? compose(this.worldMat4(parentId), localMat)
      : localMat;
    this.worldMat4Cache.set(id, worldMat);
    return worldMat;
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

  /**
   * World AABB of a node — union of (own solids + descendants' solids) all
   * transformed into world coordinates. Computed by walking each owned
   * solid's local AABB corners through the node's world matrix and
   * re-bounding.
   */
  aabbOf(id: string): AABB {
    const cached = this.aabbCache.get(id);
    if (cached) return cached;
    const node = this.byId.get(id);
    if (!node) return EMPTY_AABB;
    const aabb = unionAABB(this.collectWorldSolidAABBs(node));
    this.aabbCache.set(id, aabb);
    return aabb;
  }

  private collectWorldSolidAABBs(node: SceneNode): AABB[] {
    const out: AABB[] = [];
    const worldMat = this.worldMat4(node.id);
    for (const sid of node.solids) {
      const snap = this.result.core.snapshot(sid);
      // The kernel's snapshot is in node-local coordinates. The solid may
      // itself have a non-identity `transform` (offset within its node) —
      // compose that with the node's world matrix to get the solid's world
      // matrix, then transform its local AABB corners.
      const solidMat = compose(worldMat, toMat4(snap.transform));
      out.push(transformLocalAabb(solidMat, snap.aabb));
    }
    for (const child of node.children) {
      for (const a of this.collectWorldSolidAABBs(child)) out.push(a);
    }
    return out;
  }
}

// ───────────────────────────── helpers ─────────────────────────────

const EMPTY_AABB: AABB = { min: [0, 0, 0], max: [0, 0, 0] };

function getPosition(node: SceneNode): Vec3 {
  // CabinetNode's params always carry position/rotation; PanelInput's
  // position is required; others default to ZERO via the geometry builder.
  const p = (node.params as { position?: Vec3 }).position;
  return p ?? [0, 0, 0];
}

function getRotation(node: SceneNode): Vec3 {
  const r = (node.params as { rotation?: Vec3 }).rotation;
  return r ?? [0, 0, 0];
}

function transformLocalAabb(m: Mat4, aabb: AABB): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = (i & 1) ? aabb.max[0] : aabb.min[0];
    const y = (i & 2) ? aabb.max[1] : aabb.min[1];
    const z = (i & 4) ? aabb.max[2] : aabb.min[2];
    const [wx, wy, wz] = transformPoint(m, [x, y, z]);
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

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
