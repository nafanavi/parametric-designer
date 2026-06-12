import type { CoreAPI, BoxParams } from './api';
import type { SolidId, SolidSnapshot, Transform, TriangleMesh, Vec3 } from './types';
import {
  IDENTITY_TRANSFORM,
  compose,
  fromMat4,
  toMat4,
  transformedAabb,
} from './math/transform';

type StubOp =
  | { kind: 'box'; size: Vec3; transform: Transform }
  | { kind: 'translate'; src: SolidId; delta: Vec3 }
  | { kind: 'rotate'; src: SolidId; rotation: Vec3 }
  | { kind: 'transform'; src: SolidId; transform: Transform }
  | { kind: 'union'; a: SolidId; b: SolidId }
  | { kind: 'subtract'; a: SolidId; b: SolidId };

const defaultTransform = (t?: Partial<Transform>): Transform => ({
  translation: t?.translation ?? IDENTITY_TRANSFORM.translation,
  rotation: t?.rotation ?? IDENTITY_TRANSFORM.rotation,
});

/**
 * In-memory BREP stand-in. The CoreAPI shape is what matters — the implementation
 * just records operations and emits a box mesh per solid so the viewer has
 * something to draw. Replaced with a ClassCAD-backed kernel later.
 */
export function createStubCore(): CoreAPI {
  const ops = new Map<SolidId, StubOp>();
  // Snapshots are pure functions of `SolidId` — once an op is recorded its
  // inputs never mutate (the API only adds ops, never edits them). Caching
  // by id collapses the per-render churn that otherwise allocates fresh
  // mesh arrays on every `snapshot()` call.
  const snapshotCache = new Map<SolidId, SolidSnapshot>();
  let counter = 0;
  const nextId = (): SolidId => `s${++counter}` as SolidId;

  const boxMesh = (size: Vec3): TriangleMesh => {
    const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const positions = new Float32Array([
      -sx, -sy, -sz,  sx, -sy, -sz,  sx,  sy, -sz, -sx,  sy, -sz,
      -sx, -sy,  sz,  sx, -sy,  sz,  sx,  sy,  sz, -sx,  sy,  sz,
    ]);
    const indices = new Uint32Array([
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0,
    ]);
    const normals = new Float32Array(positions.length);
    return { positions, indices, normals };
  };

  /**
   * Walk the op chain back to the leaf box, composing each layer's matrix.
   * Returns the final Transform (decomposed from the composed Mat4) so
   * callers can hand it to the viewer without knowing about Mat4 at all.
   */
  const resolveTransform = (id: SolidId): Transform => {
    const op = ops.get(id);
    if (!op) throw new Error(`Unknown solid ${id}`);
    if (op.kind === 'box') return op.transform;
    if (op.kind === 'translate') {
      const inner = resolveTransform(op.src);
      return {
        translation: [
          inner.translation[0] + op.delta[0],
          inner.translation[1] + op.delta[1],
          inner.translation[2] + op.delta[2],
        ],
        rotation: inner.rotation,
      };
    }
    if (op.kind === 'rotate') {
      const inner = resolveTransform(op.src);
      const composed = compose(
        toMat4({ translation: [0, 0, 0], rotation: op.rotation }),
        toMat4(inner),
      );
      return fromMat4(composed);
    }
    if (op.kind === 'transform') {
      const inner = resolveTransform(op.src);
      const composed = compose(toMat4(op.transform), toMat4(inner));
      return fromMat4(composed);
    }
    // boolean ops collapse to leaf transform of `a` in the stub
    return resolveTransform(op.kind === 'union' ? op.a : op.a);
  };

  const resolveSize = (id: SolidId): Vec3 => {
    const op = ops.get(id);
    if (!op) throw new Error(`Unknown solid ${id}`);
    if (op.kind === 'box') return op.size;
    if (op.kind === 'translate' || op.kind === 'rotate' || op.kind === 'transform') {
      return resolveSize(op.src);
    }
    return resolveSize(op.a);
  };

  return {
    box(params: BoxParams): SolidId {
      const id = nextId();
      ops.set(id, { kind: 'box', size: params.size, transform: defaultTransform(params.transform) });
      return id;
    },
    translate(src, delta) {
      const id = nextId();
      ops.set(id, { kind: 'translate', src, delta });
      return id;
    },
    rotate(src, rotation) {
      const id = nextId();
      ops.set(id, { kind: 'rotate', src, rotation });
      return id;
    },
    transform(src, transform) {
      const id = nextId();
      ops.set(id, { kind: 'transform', src, transform });
      return id;
    },
    union(a, b) {
      const id = nextId();
      ops.set(id, { kind: 'union', a, b });
      return id;
    },
    subtract(a, b) {
      const id = nextId();
      ops.set(id, { kind: 'subtract', a, b });
      return id;
    },
    snapshot(id): SolidSnapshot {
      const cached = snapshotCache.get(id);
      if (cached) return cached;
      const size = resolveSize(id);
      const transform = resolveTransform(id);
      const snap: SolidSnapshot = {
        id,
        mesh: boxMesh(size),
        aabb: transformedAabb(size, transform),
        transform,
      };
      snapshotCache.set(id, snap);
      return snap;
    },
    list() {
      return Array.from(ops.keys());
    },
    reset() {
      ops.clear();
      snapshotCache.clear();
      counter = 0;
    },
  };
}
