import type { SolidId, Vec3 } from '@/core/types';
import type { SourceRange } from '@/model/ast/types';

export type CabinetNodeType = 'cabinet' | 'panel' | 'shelf' | 'door' | 'drawer';

export interface SceneNodeBase<T extends CabinetNodeType, P> {
  readonly type: T;
  readonly id: string;
  readonly callIndex: number;
  /**
   * Byte offsets into the model source of the originating `api.X(...)` call.
   * Optional because synthetic/unwrapped flows may not have it; today every
   * DomainAPI-produced node does. Frame panels emitted internally by
   * `api.cabinet` inherit the cabinet call's range — they "came from" that
   * call.
   */
  readonly sourceRange?: SourceRange;
  readonly params: P;
  readonly solids: readonly SolidId[];
  readonly children: readonly SceneNode[];
}

/**
 * Stored cabinet params — the resolved (post-default) values that the
 * SceneNode actually carries. `position` is required (defaults to [0,0,0]
 * are resolved at construction time). Cabinet is now a frame only: shelves,
 * doors, and drawers are added by separate `api.shelf` / `api.door` /
 * `api.drawer` calls referencing the cabinet via `in:`.
 */
export interface CabinetParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly thickness: number;
  readonly position: Vec3;
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
  readonly side: 'left' | 'right' | 'full';
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

// ─── Input types (what users write in api.X({...})) ───
// These are the *authoring* shape; the stored params above are computed
// from these at construction time.

export interface CabinetInput {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly thickness: number;
  readonly position?: Vec3;
}

export interface ShelfInput {
  /** Parent cabinet to mount this shelf inside. */
  readonly in: SceneNode;
  /** Height above the cabinet's floor, in millimetres. */
  readonly y: number;
  /** Optional gap from the front edge. Defaults to 0. */
  readonly inset?: number;
}

export interface DoorInput {
  /** Parent cabinet to mount this door on. */
  readonly in: SceneNode;
  /** Which half (or all) of the cabinet front this door covers. */
  readonly side: 'left' | 'right' | 'full';
  /** Optional hinge override; defaults to `side === 'right' ? 'right' : 'left'`. */
  readonly hinge?: 'left' | 'right';
}

export interface DrawerInput {
  /** Parent cabinet to mount this drawer inside. */
  readonly in: SceneNode;
  /** Height of the drawer's bottom above the cabinet floor. */
  readonly y: number;
  /** Vertical span of the drawer. */
  readonly height: number;
}

export interface PanelInput {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly position: Vec3;
}
