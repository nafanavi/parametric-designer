/**
 * Per-type geometry computation for shelf / door / drawer.
 *
 * Each function takes the user's authoring input plus an optional parent
 * `CabinetParams`, and returns the resolved stored `*Params` plus a freshly-
 * created kernel solid. Two call sites:
 *
 *   1. `api.shelf/door/drawer` use these to build the node initially. At
 *      that point there is no parent — the node is free-floating and gets
 *      placeholder defaults (sensible enough that it's selectable and
 *      drag-droppable in the viewport).
 *
 *   2. `ModelEvaluationSession.adopt()` re-runs the same function with
 *      `parent` set when a cabinet's `children: [...]` array consumes the
 *      node. The node's `params` and `solids` fields are replaced in
 *      place with the parent-relative result.
 *
 * Keeping the standalone and adopted math in one place means a future
 * tweak (e.g. inset semantics, hinge offset) lands in exactly one spot.
 *
 * Rotation handling: a cabinet's rotation propagates to its adopted
 * children. The child's *local* centre (in the cabinet's interior frame)
 * is computed first, then rotated by the cabinet's rotation and offset
 * by the cabinet's position to produce the world centre. The child stores
 * the cabinet's rotation so its solid renders aligned with the cabinet.
 * Standalone (un-adopted) children use their own `rotation` field.
 */

import type { CoreAPI } from '@/core/api';
import { applyToLocalPoint } from '@/core/math/transform';
import type { SolidId, Vec3 } from '@/core/types';
import type {
  CabinetParams,
  DoorInput,
  DoorParams,
  DrawerInput,
  DrawerParams,
  ShelfInput,
  ShelfParams,
} from './types';

export interface GeometryResult<P> {
  readonly params: P;
  readonly solid: SolidId;
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * Place a child centre inside a (possibly rotated) cabinet. `localCentre`
 * is in cabinet-local coordinates with the cabinet's origin at its
 * `position`; the result is in world space.
 */
function placeInCabinet(parent: CabinetParams, localCentre: Vec3): Vec3 {
  // `localCentre` is given relative to the cabinet's `position` already
  // (the per-type math below was previously written that way) — so apply
  // rotation around the cabinet origin, then translate to world.
  const offsetFromCabinet: Vec3 = [
    localCentre[0] - parent.position[0],
    localCentre[1] - parent.position[1],
    localCentre[2] - parent.position[2],
  ];
  return applyToLocalPoint(
    { translation: parent.position, rotation: parent.rotation },
    offsetFromCabinet,
  );
}

export function shelfGeometry(
  core: CoreAPI,
  input: ShelfInput,
  parent?: CabinetParams,
): GeometryResult<ShelfParams> {
  const inset = input.inset ?? 0;
  let width: number;
  let depth: number;
  let thickness: number;
  let centre: Vec3;
  let rotation: Vec3;

  if (parent) {
    const [px, py, pz] = parent.position;
    // Interior dimensions: subtract frame thickness on each side.
    width = parent.width - 2 * parent.thickness;
    depth = parent.depth - parent.thickness - inset;
    thickness = parent.thickness;
    const localCentre: Vec3 = [
      px,
      py + input.y,
      pz + parent.thickness / 2 - inset / 2,
    ];
    centre = placeInCabinet(parent, localCentre);
    rotation = parent.rotation;
  } else {
    // Free-floating defaults. When `input.position` is set (catalog drop),
    // the world position from source wins; otherwise we anchor at
    // [0, input.y, 0] for the historical authoring shape `api.shelf({ y })`.
    // Either way the geometry is re-derived as soon as the shelf is
    // adopted into a cabinet.
    width = 600;
    depth = 300 - inset;
    thickness = 18;
    centre = input.position ?? [0, input.y, 0];
    rotation = input.rotation ?? ZERO;
  }

  const solid = core.box({
    size: [width, thickness, depth],
    transform: { translation: centre, rotation },
  });
  return {
    params: { width, depth, thickness, position: centre, rotation },
    solid,
  };
}

export function doorGeometry(
  core: CoreAPI,
  input: DoorInput,
  parent?: CabinetParams,
): GeometryResult<DoorParams> {
  const hinge: 'left' | 'right' =
    input.hinge ?? (input.side === 'right' ? 'right' : 'left');
  let width: number;
  let height: number;
  let thickness: number;
  let centre: Vec3;
  let rotation: Vec3;

  if (parent) {
    const [px, py, pz] = parent.position;
    height = parent.height - 2 * parent.thickness - 2;   // 1mm clearance top/bottom
    thickness = parent.thickness;
    const doorY = py + parent.height / 2;
    const doorZ = pz + parent.depth / 2 + parent.thickness / 2;
    let localCentre: Vec3;
    if (input.side === 'full') {
      width = parent.width - 2;
      localCentre = [px, doorY, doorZ];
    } else if (input.side === 'left') {
      width = parent.width / 2 - 2;
      localCentre = [px - parent.width / 4, doorY, doorZ];
    } else {
      width = parent.width / 2 - 2;
      localCentre = [px + parent.width / 4, doorY, doorZ];
    }
    centre = placeInCabinet(parent, localCentre);
    rotation = parent.rotation;
  } else {
    // Free-floating door — full-size defaults, anchored at `input.position`
    // when present (catalog drop) and otherwise at world origin so the
    // legacy bare `api.door({ side })` still produces something visible.
    width = input.side === 'full' ? 798 : 398;
    height = 1798;
    thickness = 18;
    centre = input.position ?? [0, height / 2, 0];
    rotation = input.rotation ?? ZERO;
  }

  const solid = core.box({
    size: [width, height, thickness],
    transform: { translation: centre, rotation },
  });
  return {
    params: { width, height, thickness, position: centre, rotation, hinge, side: input.side },
    solid,
  };
}

export function drawerGeometry(
  core: CoreAPI,
  input: DrawerInput,
  parent?: CabinetParams,
): GeometryResult<DrawerParams> {
  let width: number;
  let depth: number;
  let centre: Vec3;
  let rotation: Vec3;

  if (parent) {
    const [px, py, pz] = parent.position;
    width = parent.width - 2 * parent.thickness - 4;     // small clearance
    depth = parent.depth - parent.thickness;
    const localCentre: Vec3 = [
      px,
      py + input.y + input.height / 2,
      pz + parent.thickness / 2,
    ];
    centre = placeInCabinet(parent, localCentre);
    rotation = parent.rotation;
  } else {
    width = 400;
    depth = 300;
    centre = input.position ?? [0, input.y + input.height / 2, 0];
    rotation = input.rotation ?? ZERO;
  }

  const solid = core.box({
    size: [width, input.height, depth],
    transform: { translation: centre, rotation },
  });
  return {
    params: { width, height: input.height, depth, position: centre, rotation },
    solid,
  };
}
