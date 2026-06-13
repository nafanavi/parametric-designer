/**
 * Drag rules + math for the viewport.
 *
 * Pure module: no React, no Three.js. The Scene component drives the
 * pointer events; this file just answers "which axes can this node move
 * on?", "what's the clamp for inside-a-cabinet shelf y?", and "given a
 * world position, what property + value goes back into the source?".
 *
 * Frames of reference (PR-2): every SceneNode's `params.position` is
 * **local to its parent**. The pointer math runs in world space (where
 * the cursor is), but the value written back to source is in the parent's
 * local frame. Conversion happens at the project step via the parent's
 * inverse world matrix.
 */

import type {
  DoorInput,
  DrawerInput,
  SceneNode,
  ShelfInput,
} from '@/domain/cabinet/types';
import type { SceneQuery } from '@/model/scene/query';
import type { Mat4, Vec3 } from '@/core/types';
import {
  IDENTITY_MAT4,
  compose,
  toMat4,
  transformPoint,
} from '@/core/math/transform';

export interface DragAxes {
  readonly x: boolean;
  readonly y: boolean;
  readonly z: boolean;
}

export interface YBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * What the source rewrite looks like when the drag commits. Two shapes:
 *   - `positionArray`: write `position: [lx, ly, lz]` in the parent's
 *     local frame. Used for cabinets (parent=world), top-level parts.
 *     Carries the originalLocal so disabled-axis values get preserved.
 *   - `yScalar`: write a single `y: ...` literal, parent-local Y.
 *     Used for in-cabinet shelf/drawer drags — matches the authoring
 *     shape `api.shelf({ y })`. Works for rotated cabinets too: we
 *     project the proposed world point through `parentInverseWorld`
 *     and take its Y component.
 */
export type DragWrite =
  | {
      readonly kind: 'positionArray';
      readonly originalLocal: Vec3;
      /**
       * Parent's inverse world matrix. Projects a proposed world point
       * into the parent's local frame. Identity for top-level nodes.
       */
      readonly parentInverseWorld: Mat4;
    }
  | {
      readonly kind: 'yScalar';
      /** Parent's inverse world matrix — projects world Y into cabinet-local Y. */
      readonly parentInverseWorld: Mat4;
    };

export interface DragSpec {
  readonly axes: DragAxes;
  /** Clamp applied to `y` (in the SAME frame as the write — see `write`). */
  readonly yBounds: YBounds | null;
  readonly write: DragWrite;
  /** Original world position of the node's centre, used as the drag pivot. */
  readonly originalWorld: Vec3;
}

const NO_DRAG = null;
const ZERO: Vec3 = [0, 0, 0];

/**
 * Returns the drag rules for `node` given the current scene, or null when
 * the node isn't draggable.
 */
export function getDragSpec(node: SceneNode, query: SceneQuery): DragSpec | null {
  const world = query.worldTransform(node.id).translation;
  const parentInverseWorld = parentInverseWorldOf(node, query);
  const localPos = (node.params as { position?: Vec3 }).position ?? ZERO;

  switch (node.type) {
    case 'cabinet': {
      // Top-level only (cabinets are never adopted today, but be explicit).
      if (node.parentId !== null) return NO_DRAG;
      return {
        axes: { x: true, y: false, z: true },
        yBounds: null,
        write: { kind: 'positionArray', originalLocal: localPos, parentInverseWorld },
        originalWorld: world,
      };
    }
    case 'panel': {
      if (node.parentId !== null) return NO_DRAG;
      return {
        axes: { x: true, y: true, z: true },
        yBounds: null,
        write: { kind: 'positionArray', originalLocal: localPos, parentInverseWorld },
        originalWorld: world,
      };
    }
    case 'shelf':
    case 'drawer': {
      if (node.parentId === null) {
        return {
          axes: { x: true, y: true, z: true },
          yBounds: null,
          write: { kind: 'positionArray', originalLocal: localPos, parentInverseWorld },
          originalWorld: world,
        };
      }
      const parent = query.getNode(node.parentId);
      if (!parent || parent.type !== 'cabinet') return NO_DRAG;
      const cab = parent.params;
      // Interior y bounds in cabinet-local frame.
      const halfT = cab.thickness / 2;
      const yBounds: YBounds = {
        min: cab.thickness + halfT,
        max: cab.height - cab.thickness - halfT,
      };
      // Y-only drag inside the cabinet. The source shape stays
      // `api.shelf({ y })` — `parentInverseWorld` projects the world
      // drag point into cabinet-local Y, so rotated cabinets work too.
      return {
        axes: { x: false, y: true, z: false },
        yBounds,
        write: { kind: 'yScalar', parentInverseWorld },
        originalWorld: world,
      };
    }
    case 'door': {
      if (node.parentId === null) {
        return {
          axes: { x: true, y: true, z: true },
          yBounds: null,
          write: { kind: 'positionArray', originalLocal: localPos, parentInverseWorld },
          originalWorld: world,
        };
      }
      return NO_DRAG;
    }
  }
}

/**
 * Inverse world matrix of a node's parent. Used to project a world-space
 * drag result into the parent's local frame for source writes. Returns
 * identity for top-level nodes.
 */
function parentInverseWorldOf(node: SceneNode, query: SceneQuery): Mat4 {
  if (node.parentId === null) return IDENTITY_MAT4;
  const parent = query.getNode(node.parentId);
  if (!parent) return IDENTITY_MAT4;
  // Parent transform is pure rotation+translation (no scale/shear), so the
  // inverse is rotation-transpose + back-translated origin. We invert by
  // composing the inverses of each parent step from the parent down to
  // root: parent.local^-1 ∘ parent.parent.local^-1 ∘ … In matrix terms,
  // inv(A∘B∘C) = C^-1∘B^-1∘A^-1. We build it directly from the chain.
  let inv: Mat4 = IDENTITY_MAT4;
  let cur: SceneNode | null = parent;
  while (cur) {
    const localPos = (cur.params as { position?: Vec3 }).position ?? ZERO;
    const localRot = (cur.params as { rotation?: Vec3 }).rotation ?? ZERO;
    const stepInv = invertRigid(toMat4({ translation: localPos, rotation: localRot }));
    inv = compose(stepInv, inv);
    cur = cur.parentId ? query.getNode(cur.parentId) : null;
  }
  return inv;
}

/** Inverse of a rigid transform (rotation + translation, no scale). */
function invertRigid(m: Mat4): Mat4 {
  // Rotation part is the upper-left 3x3; transpose it.
  // Translation: -R^T * t
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r01 = m[4], r11 = m[5], r21 = m[6];
  const r02 = m[8], r12 = m[9], r22 = m[10];
  const tx = m[12], ty = m[13], tz = m[14];
  // Transposed rotation:
  // [ r00 r10 r20 ]
  // [ r01 r11 r21 ]
  // [ r02 r12 r22 ]
  const itx = -(r00 * tx + r10 * ty + r20 * tz);
  const ity = -(r01 * tx + r11 * ty + r21 * tz);
  const itz = -(r02 * tx + r12 * ty + r22 * tz);
  return [
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    itx, ity, itz, 1,
  ];
}

export interface CabinetRayHit {
  readonly id: string;
  /** World Y where the ray first pierces the cabinet AABB. */
  readonly entryY: number;
}

/**
 * Top-level cabinet whose AABB the ray hits first (smallest entry t).
 * Uses the SceneQuery's world AABB (rotation-aware).
 */
export function findCabinetUnderRay(
  result: { readonly nodes: readonly SceneNode[] },
  query: SceneQuery,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  excludeId?: string,
): CabinetRayHit | null {
  let bestId: string | null = null;
  let bestT = Infinity;
  for (const node of result.nodes) {
    if (node.type !== 'cabinet') continue;
    if (excludeId && node.id === excludeId) continue;
    const aabb = query.aabbOf(node.id);
    const t = rayAabbEntryT(
      origin,
      dir,
      aabb.min[0], aabb.max[0],
      aabb.min[1], aabb.max[1],
      aabb.min[2], aabb.max[2],
    );
    if (t !== null && t < bestT) {
      bestT = t;
      bestId = node.id;
    }
  }
  if (bestId === null) return null;
  return { id: bestId, entryY: origin[1] + bestT * dir[1] };
}

function rayAabbEntryT(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
): number | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  const mins = [minX, minY, minZ];
  const maxs = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    const o = origin[i];
    const d = dir[i];
    if (Math.abs(d) < 1e-9) {
      if (o < mins[i] || o > maxs[i]) return null;
      continue;
    }
    let t1 = (mins[i] - o) / d;
    let t2 = (maxs[i] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (tExit < 0) return null;
  return tEnter >= 0 ? tEnter : 0;
}

/**
 * Snap a free-floating drag position to the interior of a cabinet — what
 * the part will look like once adopted. Returns the cabinet's WORLD centre
 * X/Z with Y clamped to the interior range so the user sees the shelf sit
 * inside the cabinet during the drag.
 */
export function snapToCabinetInterior(
  cabinet: SceneNode & { type: 'cabinet' },
  query: SceneQuery,
  worldY: number,
): readonly [number, number, number] {
  const cab = cabinet.params;
  const cabWorld = query.worldTransform(cabinet.id).translation;
  const halfT = cab.thickness / 2;
  const yMin = cabWorld[1] + cab.thickness + halfT;
  const yMax = cabWorld[1] + cab.height - cab.thickness - halfT;
  const clampedY = clamp(worldY, yMin, yMax);
  return [cabWorld[0], clampedY, cabWorld[2]];
}

/**
 * Source snippet for adopting `node` into a cabinet at cabinet-floor-
 * relative `cabRelY`. Same shape as before; the source still uses the
 * simple `y: number` form for adoptable parts.
 */
export function snippetForAdoption(node: SceneNode, cabRelY: number): string | null {
  switch (node.type) {
    case 'shelf': {
      const input = node.adoptionInput as ShelfInput | undefined;
      const inset = input?.inset;
      const insetFrag = inset && inset !== 0 ? `, inset: ${round1(inset)}` : '';
      return `api.shelf({ y: ${round1(cabRelY)}${insetFrag} })`;
    }
    case 'door': {
      const input = node.adoptionInput as DoorInput | undefined;
      const side = input?.side ?? 'full';
      const hinge = input?.hinge;
      const hingeFrag = hinge ? `, hinge: '${hinge}'` : '';
      return `api.door({ side: '${side}'${hingeFrag} })`;
    }
    case 'drawer': {
      const input = node.adoptionInput as DrawerInput | undefined;
      const height = input?.height ?? 200;
      return `api.drawer({ y: ${round1(cabRelY)}, height: ${round1(height)} })`;
    }
    default:
      return null;
  }
}

/** Clamps a value to `[min, max]`. Tiny utility kept here so tests can hit it. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Given a drag spec and a proposed world position (in millimetres), compute
 * the (property, value) pair to write back to source.
 *
 *   - `positionArray`: project the world point into the parent's local
 *     frame via `parentInverseWorld`, honour disabled axes by restoring
 *     the original local component, clamp local Y if bounds are set,
 *     emit `position: [x, y, z]`.
 *   - `yScalar`: subtract parent floor world-Y to get cabinet-local Y
 *     (valid only for unrotated parents), clamp, emit `y: number`.
 */
export function projectDragToSource(
  spec: DragSpec,
  proposed: readonly [number, number, number],
): { readonly name: 'position' | 'y'; readonly value: number | readonly number[] } {
  if (spec.write.kind === 'positionArray') {
    const localProposed = transformPoint(spec.write.parentInverseWorld, proposed);
    let lx = spec.axes.x ? localProposed[0] : spec.write.originalLocal[0];
    let ly = spec.axes.y ? localProposed[1] : spec.write.originalLocal[1];
    let lz = spec.axes.z ? localProposed[2] : spec.write.originalLocal[2];
    if (spec.yBounds) ly = clamp(ly, spec.yBounds.min, spec.yBounds.max);
    return {
      name: 'position',
      value: [round1(lx), round1(ly), round1(lz)] as const,
    };
  }
  // yScalar: project the proposed world point into the parent's local
  // frame and take Y. Works for rotated parents because the inverse
  // world matrix maps world deltas onto the parent's local axes.
  const localProposed = transformPoint(spec.write.parentInverseWorld, proposed);
  let localY = localProposed[1];
  if (spec.yBounds) localY = clamp(localY, spec.yBounds.min, spec.yBounds.max);
  return { name: 'y', value: round1(localY) };
}

/**
 * Round to 1 decimal place (0.1 mm precision). Keeps the rewritten source
 * readable and makes drag-commits deterministic for tests.
 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
