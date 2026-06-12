import type { SolidId, SolidSnapshot, Transform, Vec3 } from './types';

export interface BoxParams {
  readonly size: Vec3;
  readonly transform?: Partial<Transform>;
}

export interface CoreAPI {
  box(params: BoxParams): SolidId;

  translate(id: SolidId, delta: Vec3): SolidId;

  /** Rotate by intrinsic XYZ Euler degrees, around the solid's local origin. */
  rotate(id: SolidId, rotation: Vec3): SolidId;

  /** General placement: applies the full Transform (rotation around local
   *  origin, then translation). Escape hatch when callers already hold a
   *  `Transform` and don't want to split it into `rotate` + `translate`. */
  transform(id: SolidId, transform: Transform): SolidId;

  union(a: SolidId, b: SolidId): SolidId;
  subtract(a: SolidId, b: SolidId): SolidId;

  snapshot(id: SolidId): SolidSnapshot;
  list(): readonly SolidId[];
  reset(): void;
}
