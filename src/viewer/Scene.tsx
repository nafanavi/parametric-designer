'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Html } from '@react-three/drei';
import { useModelStore } from '@/store/modelStore';
import { SolidMesh } from './SolidMesh';
import type { SceneNode } from '@/domain/cabinet/types';
import type { CoreAPI } from '@/core/api';

/** Flatten the scene tree to leaves (nodes that own their visible solids). */
function* leaves(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const n of nodes) {
    if (n.children.length === 0) {
      yield n;
    } else {
      yield* leaves(n.children);
    }
  }
}

/**
 * Combined AABB of every solid on `node` (in mm — the authoring space).
 * Returns null when the node has no solids. Used to anchor the repair
 * spinner above the part the user just acted on.
 */
function aggregateAabb(
  node: SceneNode,
  core: CoreAPI,
): { min: [number, number, number]; max: [number, number, number] } | null {
  if (node.solids.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const sid of node.solids) {
    const aabb = core.snapshot(sid).aabb;
    if (aabb.min[0] < minX) minX = aabb.min[0];
    if (aabb.min[1] < minY) minY = aabb.min[1];
    if (aabb.min[2] < minZ) minZ = aabb.min[2];
    if (aabb.max[0] > maxX) maxX = aabb.max[0];
    if (aabb.max[1] > maxY) maxY = aabb.max[1];
    if (aabb.max[2] > maxZ) maxZ = aabb.max[2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function Scene() {
  const result = useModelStore((s) => s.result);
  const selection = useModelStore((s) => s.selection);
  const isRepairing = useModelStore((s) => s.isRepairing);
  const rawSelect = useModelStore((s) => s.select);

  // Gate selection changes while a repair is in flight. Camera controls and
  // hover effects stay live — the user can still orbit/inspect, just can't
  // re-target the action until the in-flight one settles.
  const select = isRepairing ? () => {} : rawSelect;

  const allLeaves = Array.from(leaves(result.nodes));

  // Anchor for the repair spinner: top-centre of the selected leaf's AABB,
  // lifted 60mm so it floats just above the part. null on the happy path
  // (no repair in flight or nothing selected) — the spinner doesn't render.
  let spinnerAnchor: [number, number, number] | null = null;
  if (isRepairing && selection) {
    const node = allLeaves.find((n) => n.id === selection);
    const bb = node ? aggregateAabb(node, result.core) : null;
    if (bb) {
      spinnerAnchor = [
        (bb.min[0] + bb.max[0]) / 2,
        bb.max[1] + 60,
        (bb.min[2] + bb.max[2]) / 2,
      ];
    }
  }

  return (
    <Canvas
      shadows
      camera={{ position: [2.5, 2, 2.5], fov: 45, near: 0.01, far: 100 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={['#15171b']} />
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[3, 5, 2]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Environment preset="city" />

      {/* Model is authored in millimetres; scale down for a metres-based scene. */}
      <group scale={0.001}>
        {allLeaves.map((node) =>
          node.solids.map((solidId) => {
            const snap = result.core.snapshot(solidId);
            return (
              <SolidMesh
                key={`${node.id}:${solidId}`}
                snapshot={snap}
                selected={selection === node.id}
                nodeType={node.type}
                onSelect={() => select(node.id)}
              />
            );
          }),
        )}
        {spinnerAnchor && (
          <Html position={spinnerAnchor} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-panel-2/95 border border-border shadow-lg whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
              <span className="text-[10px] text-gray-200">Updating…</span>
            </div>
          </Html>
        )}
      </group>

      <Grid
        args={[10, 10]}
        cellSize={0.1}
        sectionSize={1}
        sectionColor="#3a3d44"
        cellColor="#272a30"
        fadeDistance={20}
        infiniteGrid
      />
      <OrbitControls makeDefault target={[0, 0.5, 0]} />
    </Canvas>
  );
}
