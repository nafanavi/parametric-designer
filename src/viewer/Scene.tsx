'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Html, Edges } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useModelStore } from '@/store/modelStore';
import { SolidMesh } from './SolidMesh';
import { queryOf } from '@/model/scene/query';
import { promoteToConceptualOwner } from '@/model/runtime/selection';
import {
  findCabinetUnderCursor,
  getDragSpec,
  projectDragToSource,
  snapToCabinetInterior,
  type DragSpec,
} from './dragController';
import {
  findChildrenArrayRange,
  insertArrayElement,
} from '@/model/ast/rewrite';
import { CATALOG_ITEMS, dropCentre, type CatalogItem } from '@/editor/catalog';
import type { SceneNode } from '@/domain/cabinet/types';

const MM_PER_UNIT = 1000; // scene group is scaled 0.001 (mm → metres)

interface ActiveDrag {
  readonly ownerId: string;
  readonly spec: DragSpec;
  readonly plane: THREE.Plane;
  /** Pointer's first plane-hit in millimetres — drag math is delta-from-here. */
  readonly anchorMm: THREE.Vector3;
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
  const setCatalogDragGhost = useModelStore((s) => s.setCatalogDragGhost);
  const cancelCatalogDrag = useModelStore((s) => s.cancelCatalogDrag);
  const applyEdit = useModelStore((s) => s.applyEdit);

  const { camera, raycaster, gl } = useThree();
  const orbitRef = useRef<OrbitControlsImpl | null>(null);

  // Drag state lives in a ref so pointermove handlers always see the live
  // values (state would lag behind by one render). The transient visual
  // offset goes through React state so the affected meshes re-render.
  const dragRef = useRef<ActiveDrag | null>(null);
  const [dragOffsetMm, setDragOffsetMm] = useState<readonly [number, number, number]>([0, 0, 0]);
  // When the dragged part's cursor crosses a cabinet's footprint, this
  // holds that cabinet's id — the renderer outlines it (drop-target hint)
  // and the scene-drag offset snaps the part to the cabinet's interior.
  // Set during scene drag AND catalog drag; null otherwise.
  const [candidateParentId, setCandidateParentId] = useState<string | null>(null);

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

      // Adoption preview: only for free-floating drags (positionArray write)
      // whose owner is an adoptable type. When the cursor lands inside a
      // cabinet's XZ footprint, we override the visual offset so the part
      // snaps to that cabinet's interior — matching what `adopt()` will do
      // on commit. The same cabinet id gets highlighted by `renderNode`.
      let candidateId: string | null = null;
      if (drag.spec.write.kind === 'positionArray') {
        const owner = query.getNode(drag.ownerId);
        const adoptable =
          owner?.type === 'shelf' || owner?.type === 'door' || owner?.type === 'drawer';
        if (adoptable) {
          const proposedX = drag.spec.originalWorld[0] + next[0];
          const proposedY = drag.spec.originalWorld[1] + next[1];
          const proposedZ = drag.spec.originalWorld[2] + next[2];
          candidateId = findCabinetUnderCursor(
            { nodes: result.nodes },
            proposedX,
            proposedZ,
            drag.ownerId,
          );
          if (candidateId) {
            const cab = query.getNode(candidateId);
            if (cab && cab.type === 'cabinet') {
              const snapped = snapToCabinetInterior(cab, proposedY);
              next[0] = snapped[0] - drag.spec.originalWorld[0];
              next[1] = snapped[1] - drag.spec.originalWorld[1];
              next[2] = snapped[2] - drag.spec.originalWorld[2];
            }
          }
        }
      }
      setCandidateParentId(candidateId);
      setDragOffsetMm(next);
    },
    [ndcOf, planeHitMm, query, result.nodes],
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
        setCandidateParentId(null);
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
        setCandidateParentId(null);
        return;
      }
      // Adoption commit: if a candidate cabinet was highlighted at release,
      // route through `moveSelectionIntoCabinet` (combined remove + insert
      // → single commit, selection re-resolves to the adopted node).
      // Otherwise fall through to the free-position commit.
      const dropParentId = candidateParentId;
      const owner = query.getNode(drag.ownerId);
      const adoptable =
        drag.spec.write.kind === 'positionArray' &&
        (owner?.type === 'shelf' || owner?.type === 'door' || owner?.type === 'drawer');
      setDragOffsetMm([0, 0, 0]);
      setCandidateParentId(null);
      if (dropParentId && adoptable && owner) {
        const cab = query.getNode(dropParentId);
        const cabRelY = cab && cab.type === 'cabinet'
          ? Math.max(
              cab.params.thickness + cab.params.thickness / 2,
              Math.min(
                cab.params.height - cab.params.thickness - cab.params.thickness / 2,
                proposed[1] - cab.params.position[1],
              ),
            )
          : 0;
        // Build the child snippet from the catalog's `childCode` so the
        // adopted call matches what a catalog drop would emit.
        const catalogItem = CATALOG_ITEMS.find((c) => c.nodeType === owner.type);
        if (catalogItem?.childCode) {
          void moveSelectionIntoCabinet(dropParentId, catalogItem.childCode(cabRelY));
          return;
        }
      }
      const write = projectDragToSource(drag.spec, proposed);
      void setSelectionParam(write.name, write.value);
    },
    [
      candidateParentId,
      gl.domElement,
      moveSelectionIntoCabinet,
      ndcOf,
      onWindowMove,
      planeHitMm,
      query,
      setSelectionParam,
    ],
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
      // While a catalog drag is in flight, leaf clicks are ignored — the
      // canvas pointerup commits the catalog drop instead of selecting.
      if (useModelStore.getState().catalogDrag) return;
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

  // Catalog drag — armed by `<CatalogPanel>` setting `catalogDrag`. We
  // install window-level pointer listeners only while a drag is active so
  // they don't leak. The cursor's floor-plane projection becomes the ghost
  // position (mm). On pointerup over the canvas we append a new top-level
  // call; pointerup elsewhere (or ESC) cancels.
  useEffect(() => {
    if (!catalogDrag) return;

    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const projectToFloorMm = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
      return hit.multiplyScalar(MM_PER_UNIT);
    };

    const isOverCanvas = (e: PointerEvent): boolean => {
      const rect = gl.domElement.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
    };

    const onMove = (e: PointerEvent) => {
      if (!isOverCanvas(e)) {
        // Hide the ghost while the cursor is outside the viewport.
        if (useModelStore.getState().catalogDrag?.ghostMm)
          setCatalogDragGhost(null);
        setCandidateParentId(null);
        return;
      }
      const mm = projectToFloorMm(e.clientX, e.clientY);
      if (!mm) return;
      // Adoption hit-test for the catalog drag: only items whose
      // `childCode` is non-null are adoptable (shelf/door/drawer).
      const drag = useModelStore.getState().catalogDrag;
      const item = drag ? CATALOG_BY_ID.get(drag.itemId) : null;
      const adoptable = !!item?.childCode;
      const candidate = adoptable
        ? findCabinetUnderCursor({ nodes: result.nodes }, mm.x, mm.z)
        : null;
      setCandidateParentId(candidate);
      // While over a cabinet, snap the ghost to the cabinet's interior
      // centre so the user sees the part already inside before releasing.
      if (candidate) {
        const cab = query.getNode(candidate);
        if (cab && cab.type === 'cabinet' && item) {
          const interior = snapToCabinetInterior(cab, item.defaultSize[1] / 2 + cab.params.position[1]);
          setCatalogDragGhost([interior[0], 0, interior[2]]);
          return;
        }
      }
      setCatalogDragGhost([mm.x, 0, mm.z]);
    };

    const onUp = (e: PointerEvent) => {
      const drag = useModelStore.getState().catalogDrag;
      if (!drag) return;
      // Always tear down handlers; either commit or cancel below.
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      // Snapshot then clear the candidate before any commit so a stale
      // highlight doesn't linger past adoption.
      const dropParentId = candidateParentId;
      setCandidateParentId(null);

      const item = CATALOG_BY_ID.get(drag.itemId);
      if (!item || !isOverCanvas(e)) {
        cancelCatalogDrag();
        return;
      }
      const mm = projectToFloorMm(e.clientX, e.clientY);
      if (!mm) {
        cancelCatalogDrag();
        return;
      }

      // Adoption path: drop landed inside a cabinet AND the item is
      // adoptable. Emit a child entry into the cabinet's `children: [...]`
      // via the same AST helpers `moveSelectionIntoCabinet` uses, then
      // select the new node.
      if (dropParentId && item.childCode) {
        const cab = query.getNode(dropParentId);
        if (cab && cab.type === 'cabinet') {
          const halfT = cab.params.thickness / 2;
          const interiorYMin = cab.params.thickness + halfT;
          const interiorYMax = cab.params.height - cab.params.thickness - halfT;
          // The cursor's y is 0 (floor projection); for catalog drops we
          // pick a sensible mid-cabinet y based on the item's default
          // height so the part lands somewhere visible. The user can drag
          // it after to fine-tune.
          const desiredCabRelY = item.defaultSize[1] / 2;
          const cabRelY = Math.max(interiorYMin, Math.min(interiorYMax, desiredCabRelY));
          const currentSource = useModelStore.getState().source;
          const arrayRange = findChildrenArrayRange(currentSource, cab.sourceRange!);
          if (arrayRange) {
            const newSource = insertArrayElement(
              currentSource,
              arrayRange,
              item.childCode(cabRelY),
            );
            cancelCatalogDrag();
            useModelStore.getState().setSource(newSource);
            return;
          }
          // Fall through to top-level append if the cabinet has no
          // children array literal in source.
        }
      }

      const centre = dropCentre(item, mm.x, mm.z);
      cancelCatalogDrag();
      applyEdit({ kind: 'append', code: item.code(centre[0], centre[1], centre[2]) });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      cancelCatalogDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // We intentionally re-arm only when `catalogDrag` flips from null to
    // non-null. The handlers read live values via `getState()`.
  }, [
    applyEdit,
    camera,
    cancelCatalogDrag,
    candidateParentId,
    catalogDrag,
    gl.domElement,
    query,
    raycaster,
    result.nodes,
    setCatalogDragGhost,
  ]);

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
    // Drop-target highlight: when a drag is hovering over a cabinet, its
    // frame panels (which share the cabinet's range and thus its owner-id)
    // are tinted teal so the user sees "I'll drop into THIS cabinet."
    // Distinct from selection's orange so the two cues don't collide
    // when the cabinet is also the current selection.
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
        {catalogDrag?.ghostMm &&
          (() => {
            const item = CATALOG_BY_ID.get(catalogDrag.itemId);
            if (!item) return null;
            const [w, h, d] = item.defaultSize;
            // The ghost sits ON the floor at the cursor's projected point —
            // simpler to read than centering at the part's authoring origin.
            // The actual emitted source uses `dropCentre(item, x, z)` to
            // honour each anchor convention (floorPivot vs centreOnFloor).
            const cx = catalogDrag.ghostMm[0];
            const cz = catalogDrag.ghostMm[2];
            return (
              <mesh position={[cx, h / 2, cz]}>
                <boxGeometry args={[w, h, d]} />
                <meshStandardMaterial
                  color="#ff8a4c"
                  transparent
                  opacity={0.18}
                  depthWrite={false}
                />
                <Edges color="#ff8a4c" lineWidth={2} threshold={15} />
              </mesh>
            );
          })()}
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
