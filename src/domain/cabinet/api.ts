import type { CoreAPI } from '@/core/api';
import type { SolidId, Vec3 } from '@/core/types';
import type { SourceRange } from '@/model/ast/types';
import type {
  CabinetInput,
  CabinetNodeType,
  CabinetParams,
  DoorInput,
  DrawerInput,
  PanelInput,
  SceneNode,
  ShelfInput,
} from './types';
import { shelfGeometry, doorGeometry, drawerGeometry } from './geometry';

/**
 * Context handed to a model script. The runtime owns the call counter and
 * the collection sink — domain functions just push nodes into it.
 *
 * Two attach paths:
 *   - `collect(node, parent?)` runs when the node is created. With a
 *     parent it attaches directly to `parent.children`; without one it
 *     registers as top-level. Sets `parentId` accordingly.
 *   - `adopt(parent, child)` re-parents an existing top-level node. Used
 *     by `api.cabinet({ children: [api.shelf(...)] })`: the inner shelf
 *     evaluates first (top-level), then the cabinet adopts it from there.
 *     Throws if the child is already adopted (single-parent invariant).
 */
export interface DomainContext {
  readonly core: CoreAPI;
  nextCall(): number;
  collect(node: SceneNode, parent?: SceneNode): SceneNode;
  adopt(parent: SceneNode, child: SceneNode): void;
  /**
   * Source range of the `api.X(...)` call currently being evaluated, if the
   * source was instrumented. `null` when running uninstrumented source
   * (e.g. internal tests that call the API directly).
   */
  currentSourceRange(): SourceRange | null;
}

const ZERO: Vec3 = [0, 0, 0];

export interface CabinetAPI {
  cabinet(input: CabinetInput): SceneNode;
  panel(input: PanelInput): SceneNode;
  shelf(input: ShelfInput): SceneNode;
  door(input: DoorInput): SceneNode;
  drawer(input: DrawerInput): SceneNode;
}

/**
 * Build a stable node id. With a `sourceRange` (the runtime always sets one
 * through `__withLoc` instrumentation), the id is anchored to the source
 * byte offset of the originating `api.X(...)` call — so the id survives any
 * mutation that doesn't move that call's start. The optional `label` keeps
 * frame panels (which share their cabinet's `sourceRange`) unique within
 * the cabinet (`panel@142:left`, `panel@142:right`, ...).
 *
 * Without a `sourceRange` (tests calling `createCabinetAPI(ctx)` directly,
 * uninstrumented): fall back to the runtime counter so the id stays unique
 * within the run — those flows just don't get stability across re-evaluations.
 */
function makeId(
  type: CabinetNodeType,
  range: SourceRange | undefined,
  idx: number,
  label?: string,
): string {
  if (range) return label ? `${type}@${range.start}:${label}` : `${type}@${range.start}`;
  return label ? `${type}#${idx}:${label}` : `${type}#${idx}`;
}

export function createCabinetAPI(ctx: DomainContext): CabinetAPI {
  const { core } = ctx;

  // Internal helper: emits one panel solid + the corresponding panel SceneNode.
  // Frame panels share their parent cabinet's sourceRange — they came from
  // that one call. `localCentre` is in the cabinet's local frame; the
  // panel node stores it directly. Scene-graph composition (cabinet
  // rotation propagating to its panels) is the viewer's job, not ours.
  function buildPanelChild(
    parent: SceneNode & { type: 'cabinet' },
    size: Vec3,
    localCentre: Vec3,
    idx: number,
    label: string,
    sourceRange: SourceRange | undefined,
  ): void {
    const solid = core.box({ size });
    const node: SceneNode = {
      type: 'panel',
      id: makeId('panel', sourceRange, idx, label),
      callIndex: idx,
      ...(sourceRange ? { sourceRange } : {}),
      params: {
        width: size[0],
        height: size[1],
        thickness: size[2],
        position: localCentre,
        rotation: ZERO,
      },
      solids: [solid],
      children: [],
      parentId: null,
    };
    ctx.collect(node, parent);
  }

  const currentRange = (): SourceRange | undefined => ctx.currentSourceRange() ?? undefined;

  return {
    cabinet(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const position: Vec3 = input.position ?? ZERO;
      const rotation: Vec3 = input.rotation ?? ZERO;
      const params: CabinetParams = { ...input, position, rotation };
      const { width: w, height: h, depth: d, thickness: t } = params;

      const node: SceneNode & { type: 'cabinet' } = {
        type: 'cabinet',
        id: makeId('cabinet', sourceRange, idx),
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [],   // cabinet itself owns no solid; its frame is its children
        children: [],
        parentId: null,
      };
      ctx.collect(node);

      // Frame: left, right, top, bottom, back panels. Centres are in
      // cabinet-local coordinates (cabinet origin = cabinet's `position`),
      // y measured up from the cabinet floor. The viewer's nested groups
      // compose the cabinet's own position+rotation on top.
      buildPanelChild(node, [t, h, d],          [-w / 2 + t / 2, h / 2, 0],                idx, 'left',   sourceRange);
      buildPanelChild(node, [t, h, d],          [ w / 2 - t / 2, h / 2, 0],                idx, 'right',  sourceRange);
      buildPanelChild(node, [w, t, d],          [0, h - t / 2, 0],                          idx, 'top',    sourceRange);
      buildPanelChild(node, [w, t, d],          [0, t / 2, 0],                              idx, 'bottom', sourceRange);
      buildPanelChild(node, [w, h, t],          [0, h / 2, -d / 2 + t / 2],                 idx, 'back',   sourceRange);

      // Adopt explicitly-nested children. These ran first (arguments evaluate
      // left-to-right), registered as top-level, and now get re-parented.
      // Position math is unchanged in PR-A — see CabinetInput.children doc.
      for (const child of input.children ?? []) {
        ctx.adopt(node, child);
      }

      return node;
    },

    panel(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const rotation = input.rotation ?? ZERO;
      // Solid is authored at the panel node's origin; the node carries the
      // panel's local position+rotation (relative to its parent or world).
      const solid = core.box({
        size: [input.width, input.height, input.thickness],
      });
      const node: SceneNode = {
        type: 'panel',
        id: makeId('panel', sourceRange, idx),
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params: { ...input, rotation },
        solids: [solid],
        children: [],
        parentId: null,
      };
      return ctx.collect(node);
    },

    shelf(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const { params, solid } = shelfGeometry(core, input);
      const node: SceneNode = {
        type: 'shelf',
        id: makeId('shelf', sourceRange, idx),
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [solid],
        children: [],
        parentId: null,
        adoptionInput: input,
      };
      return ctx.collect(node);
    },

    door(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const { params, solid } = doorGeometry(core, input);
      const node: SceneNode = {
        type: 'door',
        id: makeId('door', sourceRange, idx),
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [solid],
        children: [],
        parentId: null,
        adoptionInput: input,
      };
      return ctx.collect(node);
    },

    drawer(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const { params, solid } = drawerGeometry(core, input);
      const node: SceneNode = {
        type: 'drawer',
        id: makeId('drawer', sourceRange, idx),
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [solid],
        children: [],
        parentId: null,
        adoptionInput: input,
      };
      return ctx.collect(node);
    },
  };
}

// Re-export SolidId so callers needing it stay one import away.
export type { SolidId };
