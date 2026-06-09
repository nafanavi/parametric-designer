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
  /**
   * Id of the parent SceneNode, or `null` for top-level nodes. Set during
   * `collect()` (legacy `in:` path) or `adopt()` (new `children: [...]` path).
   * Id-only — no direct ref — to avoid cycles in serialization, structural
   * clones, and debug output.
   */
  readonly parentId: string | null;
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
  /**
   * Inline children for this cabinet. Each entry is a SceneNode produced by
   * another `api.X(...)` call (typically `api.shelf` / `api.door` /
   * `api.drawer`). Those calls execute first and register as top-level
   * nodes; the cabinet then adopts them via `ctx.adopt(...)`.
   *
   * PR-A note: adoption is mechanical only — `parentId` and the
   * `children` array are updated, but the child's stored `position` is NOT
   * re-interpreted relative to the cabinet. Authors mixing free-floating
   * `api.shelf({y})` with `children: [...]` will see world-Y placement;
   * cabinet-floor-relative `y` still requires the legacy `in:` parameter
   * until PR-B replaces the position math.
   */
  readonly children?: readonly SceneNode[];
}

export interface ShelfInput {
  /**
   * Parent cabinet to mount this shelf inside. Optional — when omitted, the
   * shelf is created as a free-floating top-level node and can be adopted
   * later via a cabinet's `children: [...]` field. With `in:`, `y` is
   * height above the cabinet floor; without it, `y` is world-Y.
   */
  readonly in?: SceneNode;
  /** Height in millimetres (cabinet-floor-relative with `in:`, world-Y without). */
  readonly y: number;
  /** Optional gap from the front edge. Defaults to 0. */
  readonly inset?: number;
}

export interface DoorInput {
  /**
   * Parent cabinet to mount this door on. Optional — when omitted, the door
   * is created as a free-floating panel and can be adopted into a cabinet
   * via its `children: [...]` field.
   */
  readonly in?: SceneNode;
  /** Which half (or all) of the cabinet front this door covers. */
  readonly side: 'left' | 'right' | 'full';
  /** Optional hinge override; defaults to `side === 'right' ? 'right' : 'left'`. */
  readonly hinge?: 'left' | 'right';
}

export interface DrawerInput {
  /**
   * Parent cabinet to mount this drawer inside. Optional — when omitted, the
   * drawer renders as a free-floating box and can be adopted into a cabinet
   * via its `children: [...]` field.
   */
  readonly in?: SceneNode;
  /** Height in millimetres (cabinet-floor-relative with `in:`, world-Y without). */
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
