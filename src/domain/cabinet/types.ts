import type { SolidId, Vec3 } from '@/core/types';

export type CabinetNodeType = 'cabinet' | 'panel' | 'shelf' | 'door' | 'drawer';

export interface SceneNodeBase<T extends CabinetNodeType, P> {
  readonly type: T;
  readonly id: string;
  readonly callIndex: number;
  readonly params: P;
  readonly solids: readonly SolidId[];
  readonly children: readonly SceneNode[];
}

export interface CabinetParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly thickness: number;
  readonly shelves: number;
  readonly doors: 0 | 1 | 2;
  readonly position?: Vec3;
}

export interface PanelParams {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly position: Vec3;
}

export interface ShelfParams {
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  readonly position: Vec3;
}

export interface DoorParams {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly position: Vec3;
  readonly hinge: 'left' | 'right';
}

export interface DrawerParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly position: Vec3;
}

export type SceneNode =
  | SceneNodeBase<'cabinet', CabinetParams>
  | SceneNodeBase<'panel', PanelParams>
  | SceneNodeBase<'shelf', ShelfParams>
  | SceneNodeBase<'door', DoorParams>
  | SceneNodeBase<'drawer', DrawerParams>;
