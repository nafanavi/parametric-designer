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
 * Frames of reference (PR-2): every stored `params.position` is **local
 * to the node's parent** — cabinet-local for adopted children, world for
 * top-level nodes. Scene-graph composition (cabinet rotation propagating
 * to its children) happens in the viewer / SceneQuery, not here. The
 * kernel solid is authored in the node's own local frame.
 *
 * Authoring override (PR-2): adopted children accept an explicit
 * `input.position: [x, y, z]` (cabinet-local). When present, that wins
 * over the per-type defaults; the `y`/`inset`/etc. fields are still
 * honoured as fallbacks so legacy sources keep working.
 */

import type { CoreAPI } from '@/core/api';
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

export function shelfGeometry(
  core: CoreAPI,
  input: ShelfInput,
  parent?: CabinetParams,
): GeometryResult<ShelfParams> {
  const inset = input.inset ?? 0;
  let width: number;
  let depth: number;
  let thickness: number;
  let localCentre: Vec3;
  let rotation: Vec3;

  if (parent) {
    // Interior dimensions: subtract frame thickness on each side.
    width = parent.width - 2 * parent.thickness;
    depth = parent.depth - parent.thickness - inset;
    thickness = parent.thickness;
    if (input.position) {
      localCentre = input.position;
    } else {
      // Default: centred on the cabinet's interior X/Z, at the user's `y`
      // above the cabinet floor. Cabinet's local origin is its `position`
      // — i.e. the floor under the cabinet's centre.
      localCentre = [0, input.y, parent.thickness / 2 - inset / 2];
    }
    // Adopted children align with the cabinet — identity rotation in the
    // cabinet's local frame. Standalone rotation is dropped on adoption.
    rotation = ZERO;
  } else {
    // Free-floating defaults. `input.position` is world-Y when present;
    // otherwise we anchor at [0, input.y, 0] for the legacy authoring
    // shape `api.shelf({ y })`.
    width = 600;
    depth = 300 - inset;
    thickness = 18;
    localCentre = input.position ?? [0, input.y, 0];
    rotation = input.rotation ?? ZERO;
  }

  // Solid is authored in the node's own local frame: the shelf node sits
  // at `localCentre` (within its parent), and the shelf box is at the
  // shelf node's origin — so the box's local transform is identity.
  const solid = core.box({
    size: [width, thickness, depth],
  });
  return {
    params: { width, depth, thickness, position: localCentre, rotation },
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
  let localCentre: Vec3;
  let rotation: Vec3;

  if (parent) {
    height = parent.height - 2 * parent.thickness - 2;   // 1mm clearance top/bottom
    thickness = parent.thickness;
    const doorY = parent.height / 2;
    const doorZ = parent.depth / 2 + parent.thickness / 2;
    if (input.position) {
      // Explicit local position wins; width comes from `side`.
      width = input.side === 'full' ? parent.width - 2 : parent.width / 2 - 2;
      localCentre = input.position;
    } else if (input.side === 'full') {
      width = parent.width - 2;
      localCentre = [0, doorY, doorZ];
    } else if (input.side === 'left') {
      width = parent.width / 2 - 2;
      localCentre = [-parent.width / 4, doorY, doorZ];
    } else {
      width = parent.width / 2 - 2;
      localCentre = [parent.width / 4, doorY, doorZ];
    }
    rotation = ZERO;
  } else {
    // Free-floating door — full-size defaults, anchored at `input.position`
    // when present (catalog drop) and otherwise at world origin so the
    // legacy bare `api.door({ side })` still produces something visible.
    width = input.side === 'full' ? 798 : 398;
    height = 1798;
    thickness = 18;
    localCentre = input.position ?? [0, height / 2, 0];
    rotation = input.rotation ?? ZERO;
  }

  const solid = core.box({
    size: [width, height, thickness],
  });
  return {
    params: { width, height, thickness, position: localCentre, rotation, hinge, side: input.side },
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
  let localCentre: Vec3;
  let rotation: Vec3;

  if (parent) {
    width = parent.width - 2 * parent.thickness - 4;     // small clearance
    depth = parent.depth - parent.thickness;
    if (input.position) {
      localCentre = input.position;
    } else {
      localCentre = [0, input.y + input.height / 2, parent.thickness / 2];
    }
    rotation = ZERO;
  } else {
    width = 400;
    depth = 300;
    localCentre = input.position ?? [0, input.y + input.height / 2, 0];
    rotation = input.rotation ?? ZERO;
  }

  const solid = core.box({
    size: [width, input.height, depth],
  });
  return {
    params: { width, height: input.height, depth, position: localCentre, rotation },
    solid,
  };
}
