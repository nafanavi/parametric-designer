'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useModelStore } from '@/store/modelStore';
import { SolidMesh } from './SolidMesh';
import { queryOf } from '@/model/scene/query';
import { promoteToConceptualOwner } from '@/model/runtime/selection';
import {
  getDragSpec,
  projectDragToSource,
  type DragSpec,
} from './dragController';
import type { SceneNode } from '@/domain/cabinet/types';

const MM_PER_UNIT = 1000; // scene group is scaled 0.001 (mm → metres)

interface ActiveDrag {
  readonly ownerId: string;
  readonly spec: DragSpec;
  readonly plane: THREE.Plane;
  /** Pointer's first plane-hit in millimetres — drag math is delta-from-here. */
  readonly anchorMm: THREE.Vector3;
}

function SceneContents() {
  const result = useModelStore((s) => s.result);
  const selection = useModelStore((s) => s.selection);
  const isRepairing = useModelStore((s) => s.isRepairing);
  const select = useModelStore((s) => s.select);
  const setSelectionParam = useModelStore((s) => s.setSelectionParam);

  const { camera, raycaster, gl } = useThree();
  const orbitRef = useRef<OrbitControlsImpl | null>(null);

  // Drag state lives in a ref so pointermove handlers always see the live
  // values (state would lag behind by one render). The transient visual
  // offset goes through React state so the affected meshes re-render.
  const dragRef = useRef<ActiveDrag | null>(null);
  const [dragOffsetMm, setDragOffsetMm] = useState<readonly [number, number, number]>([0, 0, 0]);

  const query = queryOf(result);

  /** Raycast pointer NDC → drag plane intersection, returned in millimetres. */
  const planeHitMm = useCallback(
    (ndcX: number, ndcY: number, plane: THREE.Plane): THREE.Vector3 | null => {
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return hit.multiplyScalar(MM_PER_UNIT);
    },
    [camera, raycaster],
  );

  /** Convert a DOM pointer event to canvas-NDC `[x, y]`. */
  const ndcOf = useCallback(
    (e: PointerEvent): [number, number] => {
      const rect = gl.domElement.getBoundingClientRect();
      return [
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ];
    },
    [gl.domElement],
  );

  /** Build the drag plane for a spec, in WORLD (metre) coordinates. */
  const planeFor = useCallback(
    (spec: DragSpec): THREE.Plane => {
      const origM: [number, number, number] = [
        spec.originalWorld[0] / MM_PER_UNIT,
        spec.originalWorld[1] / MM_PER_UNIT,
        spec.originalWorld[2] / MM_PER_UNIT,
      ];
      // Cabinet (XZ floor) — horizontal plane at the part's current Y.
      if (spec.axes.x && spec.axes.z && !spec.axes.y) {
        return new THREE.Plane(new THREE.Vector3(0, 1, 0), -origM[1]);
      }
      // Y-only or full 3D — face the camera so the cursor maps stably to
      // a single world point through the part's centre.
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      return new THREE.Plane().setFromNormalAndCoplanarPoint(
        camDir.negate(),
        new THREE.Vector3(origM[0], origM[1], origM[2]),
      );
    },
    [camera],
  );

  // Window-level pointer handlers — installed only while a drag is active so
  // movement is tracked even when the cursor leaves the dragged mesh's
  // screen footprint. r3f's mesh pointermove stops firing once the pointer
  // exits the mesh, which is wrong for free-drag.
  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const [ndcX, ndcY] = ndcOf(e);
      const hit = planeHitMm(ndcX, ndcY, drag.plane);
      if (!hit) return;
      const dx = hit.x - drag.anchorMm.x;
      const dy = hit.y - drag.anchorMm.y;
      const dz = hit.z - drag.anchorMm.z;
      const next: [number, number, number] = [
        drag.spec.axes.x ? dx : 0,
        drag.spec.axes.y ? dy : 0,
        drag.spec.axes.z ? dz : 0,
      ];
      // Hard-clamp the visual offset for shelves so the user feels the
      // cabinet's interior walls. Without this the mesh would translate past
      // the wall and snap on release — confusing UX.
      if (drag.spec.write.kind === 'yScalar' && drag.spec.yBounds) {
        const baseLocalY =
          drag.spec.originalWorld[1] - drag.spec.write.parentFloorY;
        const proposedLocalY = baseLocalY + dy;
        const clampedLocalY = Math.max(
          drag.spec.yBounds.min,
          Math.min(drag.spec.yBounds.max, proposedLocalY),
        );
        next[1] = clampedLocalY - baseLocalY;
      }
      setDragOffsetMm(next);
    },
    [ndcOf, planeHitMm],
  );

  const onWindowUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      try {
        gl.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // ignore: capture may not have been set if the drag never armed.
      }
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
      if (orbitRef.current) orbitRef.current.enabled = true;
      dragRef.current = null;

      // Read the current transient offset directly — state may not have
      // flushed yet, but the offset is also accumulated synchronously into
      // `next` above. Easiest correct path: re-derive from the final
      // pointer position to avoid race-with-state.
      if (!drag) {
        setDragOffsetMm([0, 0, 0]);
        return;
      }
      const [ndcX, ndcY] = ndcOf(e);
      const hit = planeHitMm(ndcX, ndcY, drag.plane);
      // Final proposed world position (mm), with axis mask + shelf clamp.
      const proposed: [number, number, number] = [
        drag.spec.originalWorld[0],
        drag.spec.originalWorld[1],
        drag.spec.originalWorld[2],
      ];
      if (hit) {
        if (drag.spec.axes.x) proposed[0] += hit.x - drag.anchorMm.x;
        if (drag.spec.axes.y) proposed[1] += hit.y - drag.anchorMm.y;
        if (drag.spec.axes.z) proposed[2] += hit.z - drag.anchorMm.z;
      }
      const same =
        proposed[0] === drag.spec.originalWorld[0] &&
        proposed[1] === drag.spec.originalWorld[1] &&
        proposed[2] === drag.spec.originalWorld[2];
      if (same) {
        // No movement — treat as a click that confirmed the existing selection.
        setDragOffsetMm([0, 0, 0]);
        return;
      }
      const write = projectDragToSource(drag.spec, proposed);
      // Clear the transient before committing so the new source positions
      // aren't double-counted in the next render.
      setDragOffsetMm([0, 0, 0]);
      void setSelectionParam(write.name, write.value);
    },
    [gl.domElement, ndcOf, onWindowMove, planeHitMm, setSelectionParam],
  );

  // Cleanup any stray listeners on unmount.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
    };
  }, [onWindowMove, onWindowUp]);

  const onLeafPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, leafId: string) => {
      e.stopPropagation();
      if (isRepairing) return;
      const ownerId = promoteToConceptualOwner(leafId, result);
      // Unselected: this press is a SELECT, not a drag. (We still gate
      // through the store's `select` for the repair-time interlock.)
      if (selection !== ownerId) {
        select(leafId);
        return;
      }
      // Already selected — try to start a drag.
      const owner = query.getNode(ownerId);
      if (!owner) return;
      const spec = getDragSpec(owner, query);
      if (!spec) return; // doors and top-level shelf/drawer fall here today.

      const plane = planeFor(spec);
      const anchor = planeHitMm(e.pointer.x, e.pointer.y, plane);
      if (!anchor) return;
      dragRef.current = { ownerId, spec, plane, anchorMm: anchor };

      if (orbitRef.current) orbitRef.current.enabled = false;
      try {
        gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
      } catch {
        // some browsers reject capture during particular event states; harmless.
      }
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowUp);
    },
    [
      gl.domElement,
      isRepairing,
      onWindowMove,
      onWindowUp,
      planeFor,
      planeHitMm,
      query,
      result,
      select,
      selection,
    ],
  );

  // Render mirrors the SceneNode tree: one `<group>` per node, recursing
  // through `children`. Three.js composes parent × child transforms via
  // each Object3D's `matrixWorld`, so a transient offset on a cabinet
  // group propagates to every descendant (frame panels AND nested
  // shelves/doors/drawers) with no per-leaf bookkeeping. SolidMesh stays
  // at its absolute world position from the snapshot; the parent group's
  // position is 0 except when this exact node is the drag owner.
  const dragOwnerId = dragRef.current?.ownerId ?? null;
  const renderNode = (node: SceneNode): React.ReactElement => {
    const isDragOwner = node.id === dragOwnerId;
    const groupPos: [number, number, number] = isDragOwner
      ? [dragOffsetMm[0], dragOffsetMm[1], dragOffsetMm[2]]
      : [0, 0, 0];
    const owner = promoteToConceptualOwner(node.id, result);
    const isSelected = selection !== null && owner === selection;
    return (
      <group key={node.id} position={groupPos}>
        {node.solids.map((solidId) => {
          const snap = result.core.snapshot(solidId);
          return (
            <SolidMesh
              key={`${node.id}:${solidId}`}
              snapshot={snap}
              selected={isSelected}
              nodeType={node.type}
              onPointerDown={(e) => onLeafPointerDown(e, node.id)}
            />
          );
        })}
        {node.children.map((child) => renderNode(child))}
      </group>
    );
  };

  // Anchor for the repair spinner: top-centre of the selected leaf's AABB,
  // lifted 60mm so it floats just above the part. null on the happy path
  // (no repair in flight or nothing selected) — the spinner doesn't render.
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
    <>
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
        {result.nodes.map((node) => renderNode(node))}
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
      <OrbitControls ref={orbitRef} makeDefault target={[0, 0.5, 0]} />
    </>
  );
}

export function Scene() {
  const select = useModelStore((s) => s.select);
  return (
    <Canvas
      shadows
      camera={{ position: [2.5, 2, 2.5], fov: 45, near: 0.01, far: 100 }}
      onPointerMissed={() => select(null)}
    >
      <SceneContents />
    </Canvas>
  );
}
