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
  findCabinetUnderRay,
  getDragSpec,
  projectDragToSource,
  snapToCabinetInterior,
  snippetForAdoption,
  type DragSpec,
} from './dragController';
import { CATALOG_ITEMS, type CatalogItem } from '@/editor/catalog';
import type { SceneNode } from '@/domain/cabinet/types';

const MM_PER_UNIT = 1000; // scene group is scaled 0.001 (mm → metres)

/**
 * Active drag state. There is at most one of these at a time, kept in a
 * `ref` so the window-level pointer handlers always see the live values
 * (state lags by one render).
 *
 * `cancelOnEscape` is the catalog-create marker: when true, pressing
 * Escape during the drag deletes the dragged node (it was created by the
 * drag's first canvas-pointermove and the user wants to undo that). When
 * false (drag of a pre-existing scene node), Escape just tears down the
 * drag without source mutation.
 */
interface ActiveDrag {
  readonly ownerId: string;
  readonly spec: DragSpec;
  readonly plane: THREE.Plane;
  /** Pointer's first plane-hit in millimetres — drag math is delta-from-here. */
  readonly anchorMm: THREE.Vector3;
  readonly cancelOnEscape: boolean;
  /** Live offset from `originalWorld` (mm). Mirrored to `dragOffsetMm` state
   *  for rendering; this ref-backed value is what pointerup commits. */
  offsetMm: [number, number, number];
}

const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG_ITEMS.map((item) => [item.id, item]),
);

function SceneContents() {
  const result = useModelStore((s) => s.result);
  const selection = useModelStore((s) => s.selection);
  const isRepairing = useModelStore((s) => s.isRepairing);
  const select = useModelStore((s) => s.select);
  const setSelectionParam = useModelStore((s) => s.setSelectionParam);
  const moveSelectionIntoCabinet = useModelStore((s) => s.moveSelectionIntoCabinet);
  const catalogDrag = useModelStore((s) => s.catalogDrag);
  const cancelCatalogDrag = useModelStore((s) => s.cancelCatalogDrag);
  const applyEdit = useModelStore((s) => s.applyEdit);
  const deleteSelection = useModelStore((s) => s.deleteSelection);

  const { camera, raycaster, gl } = useThree();
  const orbitRef = useRef<OrbitControlsImpl | null>(null);

  // Active drag (scene OR materialized catalog drag). The catalog-armed
  // phase — between catalog-tile pointerdown and first canvas pointermove —
  // is represented purely by `catalogDrag` from the store + a null
  // `dragRef`; we materialize and populate `dragRef` on the first valid
  // pointermove.
  const dragRef = useRef<ActiveDrag | null>(null);
  const [dragOffsetMm, setDragOffsetMm] = useState<readonly [number, number, number]>([0, 0, 0]);
  // Drop-target hint: cabinet whose footprint the cursor is over. Drives
  // both the teal outline on the candidate cabinet AND the interior-snap
  // visual on the dragged part.
  const [candidateParentId, setCandidateParentId] = useState<string | null>(null);

  const query = queryOf(result);

  /** Raycast pointer NDC → plane intersection, returned in millimetres. */
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

  const isOverCanvas = useCallback(
    (e: PointerEvent): boolean => {
      const rect = gl.domElement.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
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
      // Floor-plane drag (cabinet XZ) — horizontal at the part's current Y.
      if (spec.axes.x && spec.axes.z && !spec.axes.y) {
        return new THREE.Plane(new THREE.Vector3(0, 1, 0), -origM[1]);
      }
      // Y-only or full 3D — face the camera through the part's centre.
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      return new THREE.Plane().setFromNormalAndCoplanarPoint(
        camDir.negate(),
        new THREE.Vector3(origM[0], origM[1], origM[2]),
      );
    },
    [camera],
  );

  /**
   * Tear down the active drag: removes window listeners, restores
   * OrbitControls, clears transient state. `dragRef.current` is set to
   * null. Does NOT touch source — that's the caller's job (commit, cancel,
   * or no-op).
   */
  const tearDownRef = useRef<(() => void) | null>(null);
  const tearDown = useCallback(() => {
    tearDownRef.current?.();
  }, []);

  // The actual tear-down body — assigned below after the handlers exist.

  const materializeCatalogDrag = useCallback(
    (itemId: string, cursorMm: THREE.Vector3): ActiveDrag | null => {
      const item = CATALOG_BY_ID.get(itemId);
      if (!item) return null;
      // Append the top-level snippet at the cursor's floor projection.
      // Cabinets sit at floor y=0; everything else uses centre-on-floor —
      // we just emit at the cursor x/z with y derived from the item's
      // default height (cabinet: 0, others: defaultSize[1]/2). This stays
      // consistent with the previous `dropCentre` semantics without
      // exporting the helper.
      const y = item.dropAnchor === 'floorPivot' ? 0 : item.defaultSize[1] / 2;
      const code = item.code(cursorMm.x, y, cursorMm.z);
      // commitResult (via applyEdit) re-resolves selection from the
      // PREVIOUS selection — which isn't the new node. We need to find
      // the new node ourselves after the commit lands.
      applyEdit({ kind: 'append', code });
      // After applyEdit the store has new result; find the most-recently-
      // added top-level node of the matching type. It's the one with the
      // largest sourceRange.start.
      const newResult = useModelStore.getState().result;
      const newQuery = queryOf(newResult);
      let candidate: SceneNode | null = null;
      for (const n of newResult.nodes) {
        if (n.type !== item.nodeType) continue;
        if (!n.sourceRange) continue;
        if (!candidate || n.sourceRange.start > candidate.sourceRange!.start) {
          candidate = n;
        }
      }
      if (!candidate) return null;
      select(candidate.id);
      const spec = getDragSpec(candidate, newQuery);
      if (!spec) return null;
      const plane = planeFor(spec);
      // Anchor the drag at the cursor's current position so the first
      // visual offset is zero — the part sits exactly under the cursor
      // from frame one.
      const anchorMm = new THREE.Vector3(
        spec.originalWorld[0],
        spec.originalWorld[1],
        spec.originalWorld[2],
      );
      return {
        ownerId: candidate.id,
        spec,
        plane,
        anchorMm,
        cancelOnEscape: true,
        offsetMm: [0, 0, 0],
      };
    },
    [applyEdit, planeFor, select],
  );

  /** Continuous pointermove during ANY active drag (catalog-armed OR scene). */
  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      // Catalog-armed phase: cursor over the canvas for the first time
      // materialises the source node and arms a regular scene drag on it.
      if (!dragRef.current) {
        const catalog = useModelStore.getState().catalogDrag;
        if (!catalog) return; // no drag at all
        if (!isOverCanvas(e)) return; // still over the sidebar
        const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const [ndcX, ndcY] = ndcOf(e);
        const mm = planeHitMm(ndcX, ndcY, floor);
        if (!mm) return;
        const armed = materializeCatalogDrag(catalog.itemId, mm);
        if (!armed) return;
        dragRef.current = armed;
        setDragOffsetMm([0, 0, 0]);
        setCandidateParentId(null);
        return;
      }

      // Active drag: compute transient offset + candidate parent.
      const drag = dragRef.current;
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
      // Hard-clamp Y for in-cabinet shelves so the user feels the walls.
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

      // Adoption preview for free-floating drags of adoptable parts. When
      // the cursor enters a cabinet's footprint, snap the visual to the
      // interior centre + Y bounds so the user previews the adoption.
      let candidateId: string | null = null;
      if (drag.spec.write.kind === 'positionArray') {
        const owner = query.getNode(drag.ownerId);
        const adoptable =
          owner?.type === 'shelf' || owner?.type === 'door' || owner?.type === 'drawer';
        if (adoptable) {
          raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
          const ro = raycaster.ray.origin;
          const rd = raycaster.ray.direction;
          const hit = findCabinetUnderRay(
            { nodes: result.nodes },
            [ro.x * MM_PER_UNIT, ro.y * MM_PER_UNIT, ro.z * MM_PER_UNIT],
            [rd.x, rd.y, rd.z],
            drag.ownerId,
          );
          if (hit) {
            const cab = query.getNode(hit.id);
            if (cab && cab.type === 'cabinet') {
              candidateId = hit.id;
              const snapped = snapToCabinetInterior(cab, hit.entryY);
              next[0] = snapped[0] - drag.spec.originalWorld[0];
              next[1] = snapped[1] - drag.spec.originalWorld[1];
              next[2] = snapped[2] - drag.spec.originalWorld[2];
            }
          }
        }
      }
      drag.offsetMm = next;
      setCandidateParentId(candidateId);
      setDragOffsetMm(next);
    },
    [
      camera,
      isOverCanvas,
      materializeCatalogDrag,
      ndcOf,
      planeHitMm,
      query,
      raycaster,
      result.nodes,
    ],
  );

  const onWindowUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;

      // Never materialised (catalog drag released without entering canvas):
      // just tear down the catalog-armed state.
      if (!drag) {
        tearDown();
        return;
      }

      // Commit the position the user just saw — onWindowMove already
      // computed it (entryY-snap for adoption preview, plane-hit for
      // free-floating) and stored it on the drag.
      const offset = drag.offsetMm;
      const proposed: [number, number, number] = [
        drag.spec.originalWorld[0] + offset[0],
        drag.spec.originalWorld[1] + offset[1],
        drag.spec.originalWorld[2] + offset[2],
      ];
      const sameAsStart = offset[0] === 0 && offset[1] === 0 && offset[2] === 0;

      const dropParentId = candidateParentId;
      const owner = query.getNode(drag.ownerId);
      const adoptable =
        drag.spec.write.kind === 'positionArray' &&
        (owner?.type === 'shelf' || owner?.type === 'door' || owner?.type === 'drawer');

      tearDown();

      // No movement and no adoption candidate → click-through.
      if (sameAsStart && !dropParentId) return;

      // Adoption: drop landed on a cabinet AND the dragged part is
      // adoptable. The child snippet is derived from the live node
      // (preserves any user-customised door side, drawer height, shelf
      // inset) — not from a catalog template.
      if (dropParentId && adoptable && owner) {
        const cab = query.getNode(dropParentId);
        if (cab && cab.type === 'cabinet') {
          const halfT = cab.params.thickness / 2;
          const interiorYMin = cab.params.thickness + halfT;
          const interiorYMax = cab.params.height - cab.params.thickness - halfT;
          const cabRelY = Math.max(
            interiorYMin,
            Math.min(interiorYMax, proposed[1] - cab.params.position[1]),
          );
          const snippet = snippetForAdoption(owner, cabRelY);
          if (snippet) {
            void moveSelectionIntoCabinet(dropParentId, snippet);
            return;
          }
        }
      }

      // Free-floating commit: write the new position to source.
      const write = projectDragToSource(drag.spec, proposed);
      void setSelectionParam(write.name, write.value);
    },
    [
      candidateParentId,
      moveSelectionIntoCabinet,
      query,
      setSelectionParam,
      tearDown,
    ],
  );

  const onWindowKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const drag = dragRef.current;
      const catalogArmed = !!useModelStore.getState().catalogDrag;
      if (!drag && !catalogArmed) return;
      tearDown();
      if (drag?.cancelOnEscape) {
        void deleteSelection();
      }
    },
    [deleteSelection, tearDown],
  );

  // Assign the tear-down body now that the handlers it references exist.
  tearDownRef.current = () => {
    dragRef.current = null;
    setDragOffsetMm([0, 0, 0]);
    setCandidateParentId(null);
    if (orbitRef.current) orbitRef.current.enabled = true;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
    window.removeEventListener('keydown', onWindowKey);
    if (useModelStore.getState().catalogDrag) cancelCatalogDrag();
  };

  // Install window-level listeners whenever a catalog drag is armed —
  // the catalog tile's pointerdown happens OUTSIDE the canvas, so we can't
  // use the mesh's pointerdown event to install them. The listeners take
  // care of both phases: materialising on first canvas move, then driving
  // a regular scene drag until pointerup or ESC.
  useEffect(() => {
    if (!catalogDrag) return;
    if (orbitRef.current) orbitRef.current.enabled = false;
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    window.addEventListener('keydown', onWindowKey);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
      window.removeEventListener('keydown', onWindowKey);
    };
  }, [catalogDrag, onWindowMove, onWindowUp, onWindowKey]);

  // Cleanup any stray listeners on unmount.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
      window.removeEventListener('keydown', onWindowKey);
    };
  }, [onWindowMove, onWindowUp, onWindowKey]);

  /**
   * Scene-drag arm: pointerdown on a leaf mesh that's part of the current
   * selection. Click-promotion (panel of a cabinet → cabinet) happens
   * here, the UI layer — the store's `select` is the narrow primitive.
   */
  const onLeafPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, leafId: string) => {
      e.stopPropagation();
      if (isRepairing) return;
      if (useModelStore.getState().catalogDrag) return; // a catalog drag is armed; ignore mesh clicks.
      const ownerId = promoteToConceptualOwner(leafId, result);
      if (selection !== ownerId) {
        select(ownerId);
        return;
      }
      const owner = query.getNode(ownerId);
      if (!owner) return;
      const spec = getDragSpec(owner, query);
      if (!spec) return;
      const plane = planeFor(spec);
      const anchor = planeHitMm(e.pointer.x, e.pointer.y, plane);
      if (!anchor) return;
      dragRef.current = {
        ownerId,
        spec,
        plane,
        anchorMm: anchor,
        cancelOnEscape: false,
        offsetMm: [0, 0, 0],
      };
      if (orbitRef.current) orbitRef.current.enabled = false;
      try {
        gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
      } catch {
        // Some browsers reject capture in certain event states; harmless.
      }
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowUp);
      window.addEventListener('keydown', onWindowKey);
    },
    [
      gl.domElement,
      isRepairing,
      onWindowKey,
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
  // through `children`. The drag-owner's group carries the transient
  // offset; descendants ride along through `matrixWorld` composition.
  const dragOwnerId = dragRef.current?.ownerId ?? null;
  const renderNode = (node: SceneNode): React.ReactElement => {
    const isDragOwner = node.id === dragOwnerId;
    const groupPos: [number, number, number] = isDragOwner
      ? [dragOffsetMm[0], dragOffsetMm[1], dragOffsetMm[2]]
      : [0, 0, 0];
    const owner = promoteToConceptualOwner(node.id, result);
    const isSelected = selection !== null && owner === selection;
    const isDropTarget = candidateParentId !== null && owner === candidateParentId;
    return (
      <group key={node.id} position={groupPos}>
        {node.solids.map((solidId) => {
          const snap = result.core.snapshot(solidId);
          return (
            <SolidMesh
              key={`${node.id}:${solidId}`}
              snapshot={snap}
              selected={isSelected}
              dropTarget={isDropTarget}
              nodeType={node.type}
              onPointerDown={(e) => onLeafPointerDown(e, node.id)}
            />
          );
        })}
        {node.children.map((child) => renderNode(child))}
      </group>
    );
  };

  // Spinner anchor: top-centre of the selected leaf's AABB, lifted 60mm.
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
