'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { SolidSnapshot } from '@/core/types';

interface Props {
  snapshot: SolidSnapshot;
  selected: boolean;
  /**
   * Drop-target highlight: true when a drag-and-drop in progress is
   * hovering over the conceptual owner of this mesh (a cabinet about to
   * adopt the dragged part). Visualised as a teal edge outline so it
   * doesn't collide with the orange selection outline.
   */
  dropTarget?: boolean;
  nodeType: string;
  /**
   * Raw pointerdown from the mesh. The Scene decides what it means — a
   * click on an unselected mesh selects it; a press on an already-selected
   * mesh starts a drag (when the node is draggable). Bubbling is stopped
   * by the Scene's handler.
   */
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}

const COLOR_BY_TYPE: Record<string, string> = {
  panel: '#c9a26a',
  shelf: '#b8946a',
  door: '#a87a4a',
  drawer: '#9a6a40',
  cabinet: '#c9a26a',
};

const SELECTION_OUTLINE = '#ff8a4c';
const DROP_TARGET_OUTLINE = '#4cc9f0';

export function SolidMesh({ snapshot, selected, dropTarget, nodeType, onPointerDown }: Props) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(snapshot.mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(snapshot.mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [snapshot]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const [tx, ty, tz] = snapshot.transform.translation;
  const [rxDeg, ryDeg, rzDeg] = snapshot.transform.rotation;
  // Three.js uses radians and defaults to 'XYZ' intrinsic Euler order, which
  // matches our authoring convention — direct passthrough.
  const DEG = Math.PI / 180;
  const baseColor = COLOR_BY_TYPE[nodeType] ?? '#c9a26a';

  return (
    <mesh
      geometry={geometry}
      position={[tx, ty, tz]}
      rotation={[rxDeg * DEG, ryDeg * DEG, rzDeg * DEG]}
      onPointerDown={onPointerDown}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={baseColor} roughness={0.6} metalness={0.05} />
      {/* Selection indicator: outline rendered as geometry edges; the part's
          fill colour is left unchanged so a selected door still LOOKS like a
          door, not a highlighted blob. Edges sit ~angle-threshold above the
          coplanar surfaces so they show against any background.

          Drop-target wins when both are true (you're about to drop into the
          selected cabinet) — the teal outline is more informative in that
          moment than the selection's orange. */}
      {dropTarget ? (
        <Edges color={DROP_TARGET_OUTLINE} lineWidth={2} threshold={15} />
      ) : selected ? (
        <Edges color={SELECTION_OUTLINE} lineWidth={2} threshold={15} />
      ) : null}
    </mesh>
  );
}
