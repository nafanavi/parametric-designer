import type { SolidId, Vec3 } from '@/core/types';
import type { SourceRange } from '@/model/ast/types';

export type CabinetNodeType = 'cabinet' | 'panel' | 'shelf' | 'door' | 'drawer';

export interface SceneNodeBase<T extends CabinetNodeType, P, GI = undefined> {
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
   * Id of the parent SceneNode, or `null` for top-level nodes. Set by the
   * runtime during `collect()` or `adopt()`. Id-only — no direct ref — to
   * avoid cycles in serialization, structural clones, and debug output.
   */
  readonly parentId: string | null;
  /**
   * Authoring input preserved so the runtime can re-derive this node's
   * geometry against a parent — that is, when the node is consumed by a
   * cabinet's `children: [...]` array via `adopt()`, the per-type geometry
   * function is re-run with parent context and `params` + `solids` are
   * replaced with the interior-fitted result. Set on shelf / door / drawer;
   * undefined for nodes whose geometry is fully determined at call time
   * (cabinet, panel, frame panels).
   *
   * Name reflects the use, not the value: this field only matters at
   * adoption time. A top-level (un-adopted) node ignores it entirely.
   */
  readonly adoptionInput?: GI;
}

/**
 * Stored cabinet params — the resolved (post-default) values that the
 * SceneNode actually carries. `position` and `rotation` are required
 * (defaults to [0,0,0] are resolved at construction time). The cabinet is
 * a frame only; its shelves / doors / drawers live in its `children: [...]`
 * field. `rotation` is intrinsic XYZ Euler in degrees.
 */
export interface CabinetParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly thickness: number;
  readonly position: Vec3;
  readonly rotation: Vec3;
}

export interface PanelParams {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly position: Vec3;
  readonly rotation: Vec3;
}

export interface ShelfParams {
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  readonly position: Vec3;
  readonly rotation: Vec3;
}

export interface DoorParams {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly hinge: 'left' | 'right';
  readonly side: 'left' | 'right' | 'full';
}

export interface DrawerParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly position: Vec3;
  readonly rotation: Vec3;
}

export type CabinetNode = SceneNodeBase<'cabinet', CabinetParams>;
export type PanelNode = SceneNodeBase<'panel', PanelParams>;
export type ShelfNode = SceneNodeBase<'shelf', ShelfParams, ShelfInput>;
export type DoorNode = SceneNodeBase<'door', DoorParams, DoorInput>;
export type DrawerNode = SceneNodeBase<'drawer', DrawerParams, DrawerInput>;

export type SceneNode = CabinetNode | PanelNode | ShelfNode | DoorNode | DrawerNode;

// ─── Input types (what users write in api.X({...})) ───
// These are the *authoring* shape; the stored params above are computed
// from these at construction time.
//
// `rotation?: Vec3` is intrinsic XYZ Euler in degrees. Defaults to [0,0,0].
// When a shelf/door/drawer is adopted into a cabinet, any standalone
// `rotation` it carried is dropped — the child inherits the cabinet's
// rotation via the adoption recompute (same rule as `position`).

export interface CabinetInput {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly thickness: number;
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  /**
   * Inline children for this cabinet. Each entry is a SceneNode produced by
   * another `api.X(...)` call (typically `api.shelf` / `api.door` /
   * `api.drawer`). Those calls execute first and register as top-level
   * nodes; the cabinet then adopts each, re-deriving its geometry against
   * the cabinet's interior (width minus frame thickness, `y` relative to
   * the floor, etc.).
   */
  readonly children?: readonly SceneNode[];
}

export interface ShelfInput {
  /**
   * Height in millimetres. Cabinet-floor-relative when the shelf is adopted
   * into a cabinet via `children: [...]`; world-Y when the shelf is
   * top-level (free-floating, e.g. dropped from a palette).
   */
  readonly y: number;
  /** Optional gap from the front edge. Defaults to 0. */
  readonly inset?: number;
  /**
   * Optional world position for top-level (un-adopted) use, e.g. when
   * dropped from the catalog. Ignored once the node is adopted by a
   * cabinet — adoption recomputes geometry against the parent's interior.
   */
  readonly position?: Vec3;
  /** Optional rotation for top-level use. Dropped on adoption. */
  readonly rotation?: Vec3;
}

export interface DoorInput {
  /** Which half (or all) of the cabinet front this door covers. */
  readonly side: 'left' | 'right' | 'full';
  /** Optional hinge override; defaults to `side === 'right' ? 'right' : 'left'`. */
  readonly hinge?: 'left' | 'right';
  /**
   * Optional world position for top-level (un-adopted) use. Ignored when
   * adopted by a cabinet.
   */
  readonly position?: Vec3;
  /** Optional rotation for top-level use. Dropped on adoption. */
  readonly rotation?: Vec3;
}

export interface DrawerInput {
  /**
   * Height in millimetres. Cabinet-floor-relative when the drawer is
   * adopted into a cabinet via `children: [...]`; world-Y when top-level.
   */
  readonly y: number;
  /** Vertical span of the drawer. */
  readonly height: number;
  /**
   * Optional world position for top-level (un-adopted) use. Ignored when
   * adopted by a cabinet.
   */
  readonly position?: Vec3;
  /** Optional rotation for top-level use. Dropped on adoption. */
  readonly rotation?: Vec3;
}

export interface PanelInput {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly position: Vec3;
  readonly rotation?: Vec3;
}
