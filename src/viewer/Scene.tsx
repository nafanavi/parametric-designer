'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Html } from '@react-three/drei';
import { useModelStore } from '@/store/modelStore';
import { SolidMesh } from './SolidMesh';
import { queryOf } from '@/model/scene/query';
import { promoteToConceptualOwner } from '@/model/runtime/selection';
import type { SceneNode } from '@/domain/cabinet/types';

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

export function Scene() {
  const result = useModelStore((s) => s.result);
  const selection = useModelStore((s) => s.selection);
  const isRepairing = useModelStore((s) => s.isRepairing);
  const select = useModelStore((s) => s.select);
  // The selection-during-repair gate lives in the store action itself, so
  // every caller (this viewport, the Delete keydown, the property panel,
  // future drag handles) goes through one source of truth.

  const allLeaves = Array.from(leaves(result.nodes));

  // Anchor for the repair spinner: top-centre of the selected leaf's AABB,
  // lifted 60mm so it floats just above the part. null on the happy path
  // (no repair in flight or nothing selected) — the spinner doesn't render.
  // SceneQuery is memoised per RunResult, so this lookup is O(1) after the
  // first call against a given result.
  let spinnerAnchor: [number, number, number] | null = null;
  if (isRepairing && selection) {
    const bb = queryOf(result).aabbOf(selection);
    const isEmpty =
      bb.min[0] === 0 && bb.min[1] === 0 && bb.min[2] === 0 &&
      bb.max[0] === 0 && bb.max[1] === 0 && bb.max[2] === 0;
    if (!isEmpty) {
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
                // A leaf "is the selection" when its conceptual owner — the
                // first ancestor with its own sourceRange — matches. Frame
                // panels of a cabinet share the cabinet's range so they
                // light up when the cabinet is selected; a nested shelf
                // has its own range and only lights up when itself selected.
                selected={
                  selection !== null &&
                  promoteToConceptualOwner(node.id, result) === selection
                }
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
