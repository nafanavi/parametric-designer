import type { CoreAPI } from '@/core/api';
import type { SolidId, Vec3 } from '@/core/types';
import type {
  CabinetParams,
  DoorParams,
  DrawerParams,
  PanelParams,
  SceneNode,
  ShelfParams,
} from './types';

/**
 * Context handed to a model script. The runtime owns the call counter and the
 * collection sink — domain functions just push nodes into it.
 */
export interface DomainContext {
  readonly core: CoreAPI;
  nextCall(): number;
  collect(node: SceneNode): SceneNode;
}

const addVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export interface CabinetAPI {
  cabinet(params: CabinetParams): SceneNode;
  panel(params: PanelParams): SceneNode;
  shelf(params: ShelfParams): SceneNode;
  door(params: DoorParams): SceneNode;
  drawer(params: DrawerParams): SceneNode;
}

export function createCabinetAPI(ctx: DomainContext): CabinetAPI {
  const { core } = ctx;

  const makePanel = (p: PanelParams, parentCall: number): SceneNode => {
    const solid = core.box({
      size: [p.width, p.height, p.thickness],
      transform: { translation: p.position },
    });
    return {
      type: 'panel',
      id: `panel#${parentCall}-${p.position.join(',')}`,
      callIndex: parentCall,
      params: p,
      solids: [solid],
      children: [],
    };
  };

  return {
    panel(params) {
      const idx = ctx.nextCall();
      const solid = core.box({
        size: [params.width, params.height, params.thickness],
        transform: { translation: params.position },
      });
      const node: SceneNode = {
        type: 'panel',
        id: `panel#${idx}`,
        callIndex: idx,
        params,
        solids: [solid],
        children: [],
      };
      return ctx.collect(node);
    },

    shelf(params) {
      const idx = ctx.nextCall();
      const solid = core.box({
        size: [params.width, params.thickness, params.depth],
        transform: { translation: params.position },
      });
      const node: SceneNode = {
        type: 'shelf',
        id: `shelf#${idx}`,
        callIndex: idx,
        params,
        solids: [solid],
        children: [],
      };
      return ctx.collect(node);
    },

    door(params) {
      const idx = ctx.nextCall();
      const solid = core.box({
        size: [params.width, params.height, params.thickness],
        transform: { translation: params.position },
      });
      const node: SceneNode = {
        type: 'door',
        id: `door#${idx}`,
        callIndex: idx,
        params,
        solids: [solid],
        children: [],
      };
      return ctx.collect(node);
    },

    drawer(params) {
      const idx = ctx.nextCall();
      const solid = core.box({
        size: [params.width, params.height, params.depth],
        transform: { translation: params.position },
      });
      const node: SceneNode = {
        type: 'drawer',
        id: `drawer#${idx}`,
        callIndex: idx,
        params,
        solids: [solid],
        children: [],
      };
      return ctx.collect(node);
    },

    cabinet(params) {
      const idx = ctx.nextCall();
      const origin: Vec3 = params.position ?? [0, 0, 0];
      const t = params.thickness;
      const w = params.width;
      const h = params.height;
      const d = params.depth;

      const solids: SolidId[] = [];
      const children: SceneNode[] = [];

      const push = (n: SceneNode) => {
        children.push(n);
        for (const s of n.solids) solids.push(s);
      };

      // Left panel
      push(makePanel({
        width: t, height: h, thickness: d,
        position: addVec(origin, [-w / 2 + t / 2, h / 2, 0]),
      } as unknown as PanelParams, idx));
      // Right panel
      push(makePanel({
        width: t, height: h, thickness: d,
        position: addVec(origin, [w / 2 - t / 2, h / 2, 0]),
      } as unknown as PanelParams, idx));
      // Top
      push(makePanel({
        width: w, height: t, thickness: d,
        position: addVec(origin, [0, h - t / 2, 0]),
      } as unknown as PanelParams, idx));
      // Bottom
      push(makePanel({
        width: w, height: t, thickness: d,
        position: addVec(origin, [0, t / 2, 0]),
      } as unknown as PanelParams, idx));
      // Back
      push(makePanel({
        width: w, height: h, thickness: t,
        position: addVec(origin, [0, h / 2, -d / 2 + t / 2]),
      } as unknown as PanelParams, idx));

      // Shelves evenly spaced
      const interior = h - 2 * t;
      const slots = params.shelves + 1;
      for (let i = 1; i < slots; i++) {
        const y = t + (interior * i) / slots;
        const shelfSolid = core.box({
          size: [w - 2 * t, t, d - t],
          transform: { translation: addVec(origin, [0, y, t / 2]) },
        });
        solids.push(shelfSolid);
        children.push({
          type: 'shelf',
          id: `shelf#${idx}-${i}`,
          callIndex: idx,
          params: {
            width: w - 2 * t,
            depth: d - t,
            thickness: t,
            position: addVec(origin, [0, y, t / 2]),
          },
          solids: [shelfSolid],
          children: [],
        });
      }

      // Doors
      if (params.doors > 0) {
        const doorW = (w - t) / params.doors;
        for (let i = 0; i < params.doors; i++) {
          const cx = -w / 2 + t / 2 + doorW * (i + 0.5);
          const doorSolid = core.box({
            size: [doorW - 2, h - 2 * t, t],
            transform: { translation: addVec(origin, [cx, h / 2, d / 2 + t / 2]) },
          });
          solids.push(doorSolid);
          children.push({
            type: 'door',
            id: `door#${idx}-${i}`,
            callIndex: idx,
            params: {
              width: doorW - 2,
              height: h - 2 * t,
              thickness: t,
              position: addVec(origin, [cx, h / 2, d / 2 + t / 2]),
              hinge: i === 0 ? 'left' : 'right',
            },
            solids: [doorSolid],
            children: [],
          });
        }
      }

      const node: SceneNode = {
        type: 'cabinet',
        id: `cabinet#${idx}`,
        callIndex: idx,
        params,
        solids,
        children,
      };
      return ctx.collect(node);
    },
  };
}
