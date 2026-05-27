export type SolidId = string & { readonly __brand: 'SolidId' };

export type Vec3 = readonly [number, number, number];

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

export interface SolidSnapshot {
  readonly id: SolidId;
  readonly mesh: TriangleMesh;
  readonly aabb: AABB;
  readonly transform: Transform;
}
