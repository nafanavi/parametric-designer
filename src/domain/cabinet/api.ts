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
 * `collect(node, parent?)` is the single attach point:
 *   - parent provided → attach to parent.children (construction-time mutation)
 *   - parent absent → push as a top-level node
 */
export interface DomainContext {
  readonly core: CoreAPI;
  nextCall(): number;
  collect(node: SceneNode, parent?: SceneNode): SceneNode;
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
      };
      ctx.collect(node);

      const [px, py, pz] = position;
      // Frame: left, right, top, bottom, back panels.
      buildPanelChild(node, [t, h, d],          [px - w / 2 + t / 2, py + h / 2, pz],                  idx, 'left',   sourceRange);
      buildPanelChild(node, [t, h, d],          [px + w / 2 - t / 2, py + h / 2, pz],                  idx, 'right',  sourceRange);
      buildPanelChild(node, [w, t, d],          [px, py + h - t / 2, pz],                              idx, 'top',    sourceRange);
      buildPanelChild(node, [w, t, d],          [px, py + t / 2, pz],                                  idx, 'bottom', sourceRange);
      buildPanelChild(node, [w, h, t],          [px, py + h / 2, pz - d / 2 + t / 2],                  idx, 'back',   sourceRange);

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
      };
      return ctx.collect(node);
    },

    shelf(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const cab = expectCabinetParent(input.in, 'shelf');
      const inset = input.inset ?? 0;
      const [px, py, pz] = cab.position;

      // Interior dimensions (frame thickness on each side).
      const interiorW = cab.width - 2 * cab.thickness;
      const interiorD = cab.depth - cab.thickness;        // back panel only
      const shelfDepth = interiorD - inset;
      const shelfWidth = interiorW;

      const centre: Vec3 = [
        px,
        py + input.y,                                     // y is height above floor
        pz + cab.thickness / 2 - inset / 2,               // sit against back unless inset
      ];

      const solid = core.box({
        size: [shelfWidth, cab.thickness, shelfDepth],
        transform: { translation: centre },
      });

      const params: ShelfParams = {
        width: shelfWidth,
        depth: shelfDepth,
        thickness: cab.thickness,
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
      };
      return ctx.collect(node, input.in);
    },

    door(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const cab = expectCabinetParent(input.in, 'door');
      const hinge: 'left' | 'right' = input.hinge ?? (input.side === 'right' ? 'right' : 'left');
      const [px, py, pz] = cab.position;

      const doorH = cab.height - 2 * cab.thickness - 2;   // 1mm clearance top/bottom
      const doorY = py + cab.height / 2;
      const doorZ = pz + cab.depth / 2 + cab.thickness / 2;

      let doorW: number;
      let doorX: number;
      if (input.side === 'full') {
        doorW = cab.width - 2;
        doorX = px;
      } else if (input.side === 'left') {
        doorW = cab.width / 2 - 2;
        doorX = px - cab.width / 4;
      } else {
        doorW = cab.width / 2 - 2;
        doorX = px + cab.width / 4;
      }

      const centre: Vec3 = [doorX, doorY, doorZ];

      const solid = core.box({
        size: [doorW, doorH, cab.thickness],
        transform: { translation: centre },
      });

      const params: DoorParams = {
        width: doorW,
        height: doorH,
        thickness: cab.thickness,
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
      };
      return ctx.collect(node, input.in);
    },

    drawer(input) {
      const idx = ctx.nextCall();
      const sourceRange = currentRange();
      const cab = expectCabinetParent(input.in, 'drawer');
      const [px, py, pz] = cab.position;

      const drawerW = cab.width - 2 * cab.thickness - 4;  // small clearance
      const drawerD = cab.depth - cab.thickness;
      const centre: Vec3 = [
        px,
        py + input.y + input.height / 2,
        pz + cab.thickness / 2,
      ];

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
      };
      return ctx.collect(node, input.in);
    },
  };
}

// Re-export SolidId so callers needing it stay one import away.
export type { SolidId };
