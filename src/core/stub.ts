import type { CoreAPI, BoxParams } from './api';
import type { AABB, SolidId, SolidSnapshot, Transform, TriangleMesh, Vec3 } from './types';

type StubOp =
  | { kind: 'box'; size: Vec3; transform: Transform }
  | { kind: 'translate'; src: SolidId; delta: Vec3 }
  | { kind: 'union'; a: SolidId; b: SolidId }
  | { kind: 'subtract'; a: SolidId; b: SolidId };

const ZERO: Vec3 = [0, 0, 0];

const defaultTransform = (t?: Partial<Transform>): Transform => ({
  translation: t?.translation ?? ZERO,
  rotation: t?.rotation ?? ZERO,
});

const addVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

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

  const resolveTransform = (id: SolidId): Transform => {
    const op = ops.get(id);
    if (!op) throw new Error(`Unknown solid ${id}`);
    if (op.kind === 'box') return op.transform;
    if (op.kind === 'translate') {
      const inner = resolveTransform(op.src);
      return { ...inner, translation: addVec(inner.translation, op.delta) };
    }
    // boolean ops collapse to leaf transform of `a` in the stub
    return resolveTransform(op.kind === 'union' ? op.a : op.a);
  };

  const resolveSize = (id: SolidId): Vec3 => {
    const op = ops.get(id);
    if (!op) throw new Error(`Unknown solid ${id}`);
    if (op.kind === 'box') return op.size;
    if (op.kind === 'translate') return resolveSize(op.src);
    return resolveSize(op.a);
  };

  const aabbFrom = (size: Vec3, t: Transform): AABB => {
    const [tx, ty, tz] = t.translation;
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    return {
      min: [tx - hx, ty - hy, tz - hz],
      max: [tx + hx, ty + hy, tz + hz],
    };
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
        aabb: aabbFrom(size, transform),
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
