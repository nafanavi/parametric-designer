import type { SolidId, SolidSnapshot, Transform, Vec3 } from './types';

export interface BoxParams {
  readonly size: Vec3;
  readonly transform?: Partial<Transform>;
}

export interface CoreAPI {
  box(params: BoxParams): SolidId;

  translate(id: SolidId, delta: Vec3): SolidId;

  union(a: SolidId, b: SolidId): SolidId;
  subtract(a: SolidId, b: SolidId): SolidId;

  snapshot(id: SolidId): SolidSnapshot;
  list(): readonly SolidId[];
  reset(): void;
}
