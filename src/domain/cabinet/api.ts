import type { CoreAPI } from '@/core/api';
import type { SolidId, Vec3 } from '@/core/types';
import type { SourceRange } from '@/model/ast/types';
import type {
  CabinetInput,
  CabinetParams,
  DoorInput,
  DoorParams,
  DrawerInput,
  DrawerParams,
  PanelInput,
  SceneNode,
  ShelfInput,
  ShelfParams,
} from './types';

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

export function createCabinetAPI(ctx: DomainContext): CabinetAPI {
  const { core } = ctx;

  function expectCabinetParent(parent: SceneNode, callerName: string): CabinetParams {
    if (parent.type !== 'cabinet') {
      throw new Error(`api.${callerName}({ in: ... }) expects a cabinet, got '${parent.type}'`);
    }
    return parent.params;
  }

  // Internal helper: emits one panel solid + the corresponding panel SceneNode.
  // Frame panels share their parent cabinet's sourceRange — they came from
  // that one call.
  function buildPanelChild(
    parent: SceneNode,
    size: Vec3,
    centre: Vec3,
    idx: number,
    label: string,
    sourceRange: SourceRange | undefined,
  ): void {
    const solid = core.box({ size, transform: { translation: centre } });
    const node: SceneNode = {
      type: 'panel',
      id: `panel#${idx}-${label}`,
      callIndex: idx,
      ...(sourceRange ? { sourceRange } : {}),
      params: {
        width: size[0],
        height: size[1],
        thickness: size[2],
        position: centre,
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
      const params: CabinetParams = { ...input, position };
      const { width: w, height: h, depth: d, thickness: t } = params;

      const node: SceneNode = {
        type: 'cabinet',
        id: `cabinet#${idx}`,
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [],   // cabinet itself owns no solid; its frame is its children
        children: [],
        parentId: null,
      };
      ctx.collect(node);

      const [px, py, pz] = position;
      // Frame: left, right, top, bottom, back panels.
      buildPanelChild(node, [t, h, d],          [px - w / 2 + t / 2, py + h / 2, pz],                  idx, 'left',   sourceRange);
      buildPanelChild(node, [t, h, d],          [px + w / 2 - t / 2, py + h / 2, pz],                  idx, 'right',  sourceRange);
      buildPanelChild(node, [w, t, d],          [px, py + h - t / 2, pz],                              idx, 'top',    sourceRange);
      buildPanelChild(node, [w, t, d],          [px, py + t / 2, pz],                                  idx, 'bottom', sourceRange);
      buildPanelChild(node, [w, h, t],          [px, py + h / 2, pz - d / 2 + t / 2],                  idx, 'back',   sourceRange);

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
      const solid = core.box({
        size: [input.width, input.height, input.thickness],
        transform: { translation: input.position },
      });
      const node: SceneNode = {
        type: 'panel',
        id: `panel#${idx}`,
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params: input,
        solids: [solid],
        children: [],
        parentId: null,
      };
      return ctx.collect(node);
    },

    shelf(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const inset = input.inset ?? 0;

      let shelfWidth: number;
      let shelfDepth: number;
      let shelfThickness: number;
      let centre: Vec3;
      if (input.in) {
        const cab = expectCabinetParent(input.in, 'shelf');
        const [px, py, pz] = cab.position;
        // Interior dimensions (frame thickness on each side).
        const interiorW = cab.width - 2 * cab.thickness;
        const interiorD = cab.depth - cab.thickness;        // back panel only
        shelfWidth = interiorW;
        shelfDepth = interiorD - inset;
        shelfThickness = cab.thickness;
        centre = [
          px,
          py + input.y,                                     // y is height above floor
          pz + cab.thickness / 2 - inset / 2,               // sit against back unless inset
        ];
      } else {
        // Free-floating shelf — sensible defaults. PR-B will rework these
        // when nested-form is the only authoring style.
        shelfWidth = 600;
        shelfDepth = 300 - inset;
        shelfThickness = 18;
        centre = [0, input.y, 0];
      }

      const solid = core.box({
        size: [shelfWidth, shelfThickness, shelfDepth],
        transform: { translation: centre },
      });

      const params: ShelfParams = {
        width: shelfWidth,
        depth: shelfDepth,
        thickness: shelfThickness,
        position: centre,
      };

      const node: SceneNode = {
        type: 'shelf',
        id: `shelf#${idx}`,
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [solid],
        children: [],
        parentId: null,
      };
      return ctx.collect(node, input.in);
    },

    door(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const hinge: 'left' | 'right' = input.hinge ?? (input.side === 'right' ? 'right' : 'left');

      let doorW: number;
      let doorH: number;
      let doorThickness: number;
      let centre: Vec3;
      if (input.in) {
        const cab = expectCabinetParent(input.in, 'door');
        const [px, py, pz] = cab.position;
        doorH = cab.height - 2 * cab.thickness - 2;   // 1mm clearance top/bottom
        doorThickness = cab.thickness;
        const doorY = py + cab.height / 2;
        const doorZ = pz + cab.depth / 2 + cab.thickness / 2;
        if (input.side === 'full') {
          doorW = cab.width - 2;
          centre = [px, doorY, doorZ];
        } else if (input.side === 'left') {
          doorW = cab.width / 2 - 2;
          centre = [px - cab.width / 4, doorY, doorZ];
        } else {
          doorW = cab.width / 2 - 2;
          centre = [px + cab.width / 4, doorY, doorZ];
        }
      } else {
        // Free-floating door — minimum-viable defaults at world origin.
        doorW = input.side === 'full' ? 798 : 398;
        doorH = 1798;
        doorThickness = 18;
        centre = [0, doorH / 2, 0];
      }

      const solid = core.box({
        size: [doorW, doorH, doorThickness],
        transform: { translation: centre },
      });

      const params: DoorParams = {
        width: doorW,
        height: doorH,
        thickness: doorThickness,
        position: centre,
        hinge,
        side: input.side,
      };

      const node: SceneNode = {
        type: 'door',
        id: `door#${idx}`,
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [solid],
        children: [],
        parentId: null,
      };
      return ctx.collect(node, input.in);
    },

    drawer(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();

      let drawerW: number;
      let drawerD: number;
      let centre: Vec3;
      if (input.in) {
        const cab = expectCabinetParent(input.in, 'drawer');
        const [px, py, pz] = cab.position;
        drawerW = cab.width - 2 * cab.thickness - 4;  // small clearance
        drawerD = cab.depth - cab.thickness;
        centre = [
          px,
          py + input.y + input.height / 2,
          pz + cab.thickness / 2,
        ];
      } else {
        // Free-floating drawer — sensible defaults at world position.
        drawerW = 400;
        drawerD = 300;
        centre = [0, input.y + input.height / 2, 0];
      }

      const solid = core.box({
        size: [drawerW, input.height, drawerD],
        transform: { translation: centre },
      });

      const params: DrawerParams = {
        width: drawerW,
        height: input.height,
        depth: drawerD,
        position: centre,
      };

      const node: SceneNode = {
        type: 'drawer',
        id: `drawer#${idx}`,
        callIndex: idx,
        ...(sourceRange ? { sourceRange } : {}),
        params,
        solids: [solid],
        children: [],
        parentId: null,
      };
      return ctx.collect(node, input.in);
    },
  };
}

// Re-export SolidId so callers needing it stay one import away.
export type { SolidId };
