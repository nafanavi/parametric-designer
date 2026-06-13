'use client';

import { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { GripVertical, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useModelStore } from '@/store/modelStore';
import { queryOf } from '@/model/scene/query';
import type { SceneNode } from '@/domain/cabinet/types';

interface Props {
  /**
   * Hidden while a drag is in flight — the AABB anchor would jitter with the
   * drag offset, and the buttons would compete with the drag for pointer
   * events. Scene passes its `dragInFlight` flag down here.
   */
  hidden: boolean;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * Floating action bar anchored to the selected node's world-space AABB top.
 * Once the user grabs its drag handle, the bar switches to a free-floating
 * offset (px) and stops tracking the anchor — so reorienting the camera
 * mid-edit doesn't yank the bar away from the cursor. Selection change
 * resets the offset so a fresh selection re-snaps to its own anchor.
 */
export function SelectionToolbar({ hidden }: Props) {
  const selection = useModelStore((s) => s.selection);
  const result = useModelStore((s) => s.result);
  const deleteSelection = useModelStore((s) => s.deleteSelection);
  const rotateSelectionY = useModelStore((s) => s.rotateSelectionY);

  const [dragOffset, setDragOffset] = useState<[number, number]>([0, 0]);
  const dragStateRef = useRef<{
    pointerId: number;
    startClient: [number, number];
    startOffset: [number, number];
    moved: boolean;
  } | null>(null);

  // Reset offset on selection change so the toolbar snaps back to its anchor
  // for each new pick.
  useEffect(() => {
    setDragOffset([0, 0]);
  }, [selection]);

  if (!selection || hidden) return null;

  const query = queryOf(result);
  const node: SceneNode | null = query.getNode(selection);
  if (!node) return null;

  const bb = query.aabbOf(selection);
  const isEmpty =
    bb.min[0] === 0 && bb.min[1] === 0 && bb.min[2] === 0 &&
    bb.max[0] === 0 && bb.max[1] === 0 && bb.max[2] === 0;
  if (isEmpty) return null;

  // Top-centre of AABB, lifted so the bar floats above the part instead of
  // overlapping its top face.
  const anchor: [number, number, number] = [
    (bb.min[0] + bb.max[0]) / 2,
    bb.max[1] + 80,
    (bb.min[2] + bb.max[2]) / 2,
  ];

  const canRotate = node.parentId === null;

  const onHandlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startClient: [e.clientX, e.clientY],
      startOffset: dragOffset,
      moved: false,
    };
  };
  const onHandlePointerMove = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startClient[0];
    const dy = e.clientY - s.startClient[1];
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    s.moved = true;
    setDragOffset([s.startOffset[0] + dx, s.startOffset[1] + dy]);
  };
  const onHandlePointerUp = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragStateRef.current = null;
  };

  return (
    <Html
      position={anchor}
      center
      zIndexRange={[100, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          transform: `translate(${dragOffset[0]}px, ${dragOffset[1]}px)`,
          pointerEvents: 'auto',
        }}
        className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-panel-2/95 border border-border shadow-lg whitespace-nowrap select-none"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          role="button"
          aria-label="Drag toolbar"
          title="Drag"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          className="flex items-center px-0.5 py-1 text-gray-400 hover:text-gray-100 cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={14} strokeWidth={2} />
        </div>
        {canRotate && (
          <button
            type="button"
            title="Rotate -90° (Y)"
            onClick={() => { void rotateSelectionY(-90); }}
            className="flex items-center gap-1 px-1.5 py-1 text-[11px] leading-none text-gray-200 hover:text-orange-300 hover:bg-panel rounded"
          >
            <RotateCcw size={14} strokeWidth={2} />
            <span>90°</span>
          </button>
        )}
        {canRotate && (
          <button
            type="button"
            title="Rotate +90° (Y)"
            onClick={() => { void rotateSelectionY(90); }}
            className="flex items-center gap-1 px-1.5 py-1 text-[11px] leading-none text-gray-200 hover:text-orange-300 hover:bg-panel rounded"
          >
            <RotateCw size={14} strokeWidth={2} />
            <span>90°</span>
          </button>
        )}
        <button
          type="button"
          title="Delete"
          onClick={() => { void deleteSelection(); }}
          className="flex items-center px-1.5 py-1 text-gray-200 hover:text-red-300 hover:bg-panel rounded"
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    </Html>
  );
}
