export type SolidId = string & { readonly __brand: 'SolidId' };

export type Vec3 = readonly [number, number, number];

/**
 * Column-major 4x4 matrix (Three.js's `Matrix4.elements` order). Used
 * internally by the kernel for transform composition; authoring code at the
 * DomainAPI boundary works with `Transform` instead.
 */
export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/**
 * Authoring/storage transform. `translation` is in millimetres, `rotation`
 * is intrinsic XYZ Euler in degrees (rotate around local X, then local Y',
 * then local Z''). Degrees + per-axis layout keeps property-panel sliders
 * one-to-one with stored fields; intrinsic XYZ matches Three.js's default
 * Euler order so the viewer boundary is a direct passthrough.
 *
 * Quaternions / Mat4 are intentionally absent here — they live one layer
 * down, in `src/core/math/transform.ts`, used only by the kernel and AABB
 * derivation. Static furniture placement doesn't need interpolation or
 * gimbal-lock-proof composition.
 */
export interface Transform {
  readonly translation: Vec3;
  readonly rotation: Vec3;
}

export interface AABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface TriangleMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
}

/**
 * Snapshot of a single solid, in **node-local** coordinates. The kernel
 * knows nothing about the scene-graph hierarchy — it returns the solid's
 * placement relative to whichever SceneNode owns it. Composing world
 * transforms is the SceneQuery's / viewer's job (walk parents, multiply
 * matrices).
 *
 *   - `transform`: solid's placement within its owning SceneNode's frame.
 *     Usually identity for nodes that own a single solid drawn at the
 *     node's origin; non-identity for cabinets that emit multiple frame-
 *     panel solids at different offsets.
 *   - `aabb`: bounding box of the meshed solid in the SAME frame as
 *     `transform` (i.e. node-local). The world AABB is derived elsewhere.
 */
export interface SolidSnapshot {
  readonly id: SolidId;
  readonly mesh: TriangleMesh;
  readonly aabb: AABB;
  readonly transform: Transform;
}
