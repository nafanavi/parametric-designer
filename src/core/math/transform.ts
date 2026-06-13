import type { AABB, Mat4, Transform, Vec3 } from '../types';

export const IDENTITY_TRANSFORM: Transform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0],
};

export const IDENTITY_MAT4: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const DEG = Math.PI / 180;
const EPS = 1e-9;

export function hasRotation(t: Transform): boolean {
  const [rx, ry, rz] = t.rotation;
  return Math.abs(rx) > EPS || Math.abs(ry) > EPS || Math.abs(rz) > EPS;
}

/**
 * Build a column-major 4x4 from a Transform. Rotation is intrinsic XYZ
 * (rotate around local X, then local Y', then local Z''), degrees. Column-
 * major layout matches Three.js's `Matrix4.elements` order so we can pass
 * the array straight to `Matrix4.fromArray(...)` if we ever need to.
 */
export function toMat4(t: Transform): Mat4 {
  const [tx, ty, tz] = t.translation;
  const [rxDeg, ryDeg, rzDeg] = t.rotation;
  const cx = Math.cos(rxDeg * DEG);
  const sx = Math.sin(rxDeg * DEG);
  const cy = Math.cos(ryDeg * DEG);
  const sy = Math.sin(ryDeg * DEG);
  const cz = Math.cos(rzDeg * DEG);
  const sz = Math.sin(rzDeg * DEG);

  const r00 = cy * cz;
  const r01 = -cy * sz;
  const r02 = sy;
  const r10 = sx * sy * cz + cx * sz;
  const r11 = -sx * sy * sz + cx * cz;
  const r12 = -sx * cy;
  const r20 = -cx * sy * cz + sx * sz;
  const r21 = cx * sy * sz + sx * cz;
  const r22 = cx * cy;

  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    tx,  ty,  tz,  1,
  ];
}

/** parent ∘ child — applies child first, then parent. */
export function compose(parent: Mat4, child: Mat4): Mat4 {
  const out = new Array(16) as unknown as number[];
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += parent[k * 4 + row] * child[col * 4 + k];
      }
      out[col * 4 + row] = s;
    }
  }
  return out as unknown as Mat4;
}

/** Apply a Mat4 to a point (w=1). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8]  * z + m[12],
    m[1] * x + m[5] * y + m[9]  * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Decompose a Mat4 back to Transform (intrinsic XYZ Euler, degrees). Assumes
 * the matrix is a pure rotation+translation — no scale or shear. Handles the
 * gimbal-lock pole at |sin(ry)| ≈ 1 by collapsing the redundant axis to zero
 * rotation.
 */
export function fromMat4(m: Mat4): Transform {
  const sy = m[8];
  let rx: number, ry: number, rz: number;
  if (sy < 1 - 1e-6 && sy > -1 + 1e-6) {
    ry = Math.asin(sy);
    rx = Math.atan2(-m[9], m[10]);
    rz = Math.atan2(-m[4], m[0]);
  } else {
    ry = sy > 0 ? Math.PI / 2 : -Math.PI / 2;
    rx = Math.atan2(m[6], m[5]);
    rz = 0;
  }
  const r = 1 / DEG;
  return {
    translation: [m[12], m[13], m[14]],
    rotation: [rx * r, ry * r, rz * r],
  };
}

/**
 * AABB of an axis-aligned box `size` (centred at local origin) placed by
 * `transform`. Rotates the 8 corners into world space and re-bounds. Tight
 * when `rotation == 0`; loose (but correct) otherwise. Replaces the
 * translation-only AABB the stub used previously — once rotation is live,
 * a too-tight AABB breaks picking and drag bounds for any rotated solid.
 */
export function transformedAabb(size: Vec3, transform: Transform): AABB {
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  if (!hasRotation(transform)) {
    const [tx, ty, tz] = transform.translation;
    return {
      min: [tx - sx, ty - sy, tz - sz],
      max: [tx + sx, ty + sy, tz + sz],
    };
  }
  const m = toMat4(transform);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    const cx = (i & 1) ? sx : -sx;
    const cy = (i & 2) ? sy : -sy;
    const cz = (i & 4) ? sz : -sz;
    const [x, y, z] = transformPoint(m, [cx, cy, cz]);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Rotate `local` by the rotation part of `transform` and add `translation`.
 * The cabinet-children math uses this to place a child's centre relative to
 * a rotated cabinet: `worldCentre = cabinet.translation + R(cabinet) · local`.
 */
export function applyToLocalPoint(transform: Transform, local: Vec3): Vec3 {
  if (!hasRotation(transform)) {
    const [tx, ty, tz] = transform.translation;
    return [tx + local[0], ty + local[1], tz + local[2]];
  }
  return transformPoint(toMat4(transform), local);
}
