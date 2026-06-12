/**
 * Per-type geometry computation for shelf / door / drawer.
 *
 * Each function takes the user's authoring input (without the legacy `in:`
 * field) plus an optional parent `CabinetParams`, and returns the resolved
 * stored `*Params` plus a freshly-created kernel solid. Two call sites:
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

  if (parent) {
    const [px, py, pz] = parent.position;
    // Interior dimensions: subtract frame thickness on each side.
    width = parent.width - 2 * parent.thickness;
    depth = parent.depth - parent.thickness - inset;
    thickness = parent.thickness;
    centre = [
      px,
      py + input.y,
      pz + parent.thickness / 2 - inset / 2,
    ];
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
  }

  const solid = core.box({
    size: [width, thickness, depth],
    transform: { translation: centre },
  });
  return {
    params: { width, depth, thickness, position: centre },
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

  if (parent) {
    const [px, py, pz] = parent.position;
    height = parent.height - 2 * parent.thickness - 2;   // 1mm clearance top/bottom
    thickness = parent.thickness;
    const doorY = py + parent.height / 2;
    const doorZ = pz + parent.depth / 2 + parent.thickness / 2;
    if (input.side === 'full') {
      width = parent.width - 2;
      centre = [px, doorY, doorZ];
    } else if (input.side === 'left') {
      width = parent.width / 2 - 2;
      centre = [px - parent.width / 4, doorY, doorZ];
    } else {
      width = parent.width / 2 - 2;
      centre = [px + parent.width / 4, doorY, doorZ];
    }
  } else {
    // Free-floating door — full-size defaults, anchored at `input.position`
    // when present (catalog drop) and otherwise at world origin so the
    // legacy bare `api.door({ side })` still produces something visible.
    width = input.side === 'full' ? 798 : 398;
    height = 1798;
    thickness = 18;
    centre = input.position ?? [0, height / 2, 0];
  }

  const solid = core.box({
    size: [width, height, thickness],
    transform: { translation: centre },
  });
  return {
    params: { width, height, thickness, position: centre, hinge, side: input.side },
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

  if (parent) {
    const [px, py, pz] = parent.position;
    width = parent.width - 2 * parent.thickness - 4;     // small clearance
    depth = parent.depth - parent.thickness;
    centre = [
      px,
      py + input.y + input.height / 2,
      pz + parent.thickness / 2,
    ];
  } else {
    width = 400;
    depth = 300;
    centre = input.position ?? [0, input.y + input.height / 2, 0];
  }

  const solid = core.box({
    size: [width, input.height, depth],
    transform: { translation: centre },
  });
  return {
    params: { width, height: input.height, depth, position: centre },
    solid,
  };
}
