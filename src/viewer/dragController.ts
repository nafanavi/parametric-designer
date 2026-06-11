/**
 * Drag rules + math for the viewport.
 *
 * Pure module: no React, no Three.js. The Scene component drives the
 * pointer events; this file just answers "which axes can this node move
 * on?", "what's the clamp for inside-a-cabinet shelf y?", and "given a
 * world position, what property + value goes back into the source?".
 *
 * Keeping it pure means the rules are unit-testable and adding a new
 * vertical (drawer in a kitchen carcass, panel in a wardrobe) is a local
 * change — no viewport edits required.
 */

import type { SceneNode } from '@/domain/cabinet/types';
import type { SceneQuery } from '@/model/scene/query';

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
 * What the source rewrite looks like when the drag commits. The Scene
 * computes a world position; this tells it which property name carries the
 * update and how to project the world coords into the property's storage
 * convention (e.g. cabinet-floor-relative `y`, or world `[x, y, z]`).
 */
export type DragWrite =
  | { readonly kind: 'positionArray'; readonly originalY: number }
  | { readonly kind: 'yScalar'; readonly parentFloorY: number };

export interface DragSpec {
  readonly axes: DragAxes;
  /** Clamp applied to `y` (in the SAME frame as the write — see `write`). */
  readonly yBounds: YBounds | null;
  readonly write: DragWrite;
  /** Original world position of the node's centre, used as the drag pivot. */
  readonly originalWorld: readonly [number, number, number];
}

const NO_DRAG = null;

/**
 * Returns the drag rules for `node` given the current scene, or null when
 * the node isn't draggable in this PR's scope:
 *   - door (any parent)
 *   - top-level shelf / drawer (their input shape has no x/z fields, so
 *     a world drag can't round-trip through source today)
 */
export function getDragSpec(node: SceneNode, query: SceneQuery): DragSpec | null {
  switch (node.type) {
    case 'cabinet': {
      // Top-level only (cabinets are never adopted today, but be explicit).
      if (node.parentId !== null) return NO_DRAG;
      return {
        axes: { x: true, y: false, z: true },
        yBounds: null,
        write: { kind: 'positionArray', originalY: node.params.position[1] },
        originalWorld: node.params.position,
      };
    }
    case 'panel': {
      // Standalone panel (has `position` in input). Frame panels of a
      // cabinet share their cabinet's sourceRange and are promoted away
      // by the click handler — they never end up as the selection.
      if (node.parentId !== null) return NO_DRAG;
      return {
        axes: { x: true, y: true, z: true },
        yBounds: null,
        write: { kind: 'positionArray', originalY: node.params.position[1] },
        originalWorld: node.params.position,
      };
    }
    case 'shelf':
    case 'drawer': {
      if (node.parentId === null) return NO_DRAG; // top-level: deferred
      const parent = query.getNode(node.parentId);
      if (!parent || parent.type !== 'cabinet') return NO_DRAG;
      const cab = parent.params;
      // Interior y bounds in the SAME frame as the shelf's `input.y`
      // (cabinet-floor-relative). Half a thickness of clearance from the
      // top/bottom panels — keeps the shelf inside the inner volume.
      const halfT = cab.thickness / 2;
      const yBounds: YBounds = {
        min: cab.thickness + halfT,
        max: cab.height - cab.thickness - halfT,
      };
      return {
        axes: { x: false, y: true, z: false },
        yBounds,
        write: {
          kind: 'yScalar',
          parentFloorY: cab.position[1],
        },
        originalWorld: node.params.position,
      };
    }
    case 'door':
      return NO_DRAG;
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
 * the (property, value) pair that should be written back to the source.
 * Caller then passes both into `setSelectionParam(name, value)`.
 */
export function projectDragToSource(
  spec: DragSpec,
  proposed: readonly [number, number, number],
): { readonly name: 'position' | 'y'; readonly value: number | readonly number[] } {
  if (spec.write.kind === 'positionArray') {
    // Free 3D / floor-plane drag. Y is locked to the original position when
    // the cabinet drag is axes={x,z} (we honour spec.axes by snapping each
    // disabled axis back to its original).
    const x = spec.axes.x ? proposed[0] : spec.originalWorld[0];
    const y = spec.axes.y ? proposed[1] : spec.write.originalY;
    const z = spec.axes.z ? proposed[2] : spec.originalWorld[2];
    return {
      name: 'position',
      value: [round1(x), round1(y), round1(z)] as const,
    };
  }
  // yScalar: write a cabinet-floor-relative y. `proposed[1]` is world Y;
  // subtract the parent's floor world Y to get the local y. Apply clamp.
  let localY = proposed[1] - spec.write.parentFloorY;
  if (spec.yBounds) localY = clamp(localY, spec.yBounds.min, spec.yBounds.max);
  return { name: 'y', value: round1(localY) };
}

/**
 * Round to 1 decimal place (0.1 mm precision). Keeps the rewritten source
 * readable — `position: [123.4, 0, 200.7]` instead of `[123.456789, 0,
 * 200.731234]` — and makes drag-commits deterministic for tests. Real
 * cabinet making works in millimetres; tenths are plenty.
 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
