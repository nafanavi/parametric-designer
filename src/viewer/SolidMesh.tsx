'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { SolidSnapshot } from '@/core/types';

interface Props {
  snapshot: SolidSnapshot;
  selected: boolean;
  nodeType: string;
  onSelect: () => void;
}

const COLOR_BY_TYPE: Record<string, string> = {
  panel: '#c9a26a',
  shelf: '#b8946a',
  door: '#a87a4a',
  drawer: '#9a6a40',
  cabinet: '#c9a26a',
};

export function SolidMesh({ snapshot, selected, nodeType, onSelect }: Props) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(snapshot.mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(snapshot.mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [snapshot]);

  const [tx, ty, tz] = snapshot.transform.translation;
  const baseColor = COLOR_BY_TYPE[nodeType] ?? '#c9a26a';

  return (
    <mesh
      geometry={geometry}
      position={[tx, ty, tz]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={selected ? '#ff8a4c' : baseColor}
        roughness={0.6}
        metalness={0.05}
      />
    </mesh>
  );
}
