'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import { useModelStore } from '@/store/modelStore';
import { SolidMesh } from './SolidMesh';
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
  const select = useModelStore((s) => s.select);

  const allLeaves = Array.from(leaves(result.nodes));

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
