'use client';

import { useRef, useState } from 'react';

export type ResizeOrientation = 'horizontal' | 'vertical';

interface Props {
  /**
   * `horizontal` — handle is a thin horizontal bar; drag along Y axis.
   *   The `size` value being resized is a HEIGHT.
   * `vertical` — handle is a thin vertical bar; drag along X axis.
   *   The `size` value being resized is a WIDTH.
   */
  readonly orientation: ResizeOrientation;
  /** Current size in pixels (height for horizontal, width for vertical). */
  readonly size: number;
  /**
   * Direction the drag "grows" the panel. `+1`: dragging away from the
   * panel's body grows it. `-1`: dragging toward the panel's body grows
   * it. Use `-1` for handles that sit on the FAR edge from the resized
   * dimension's origin (e.g. a top-resize handle on a panel anchored to
   * the bottom; a right-resize handle on a panel anchored to the left).
   */
  readonly direction?: 1 | -1;
  /**
   * Called with the proposed next size in pixels. The caller is
   * responsible for clamping (min/max) and persisting — this component
   * stays dumb on purpose so panel-specific constraints (container
   * height, neighbour sizes, store wiring) don't leak in here.
   */
  readonly onResize: (next: number) => void;
  readonly ariaLabel?: string;
  /** Extra classes appended to the handle's container. */
  readonly className?: string;
}

/**
 * Thin draggable separator for resizing a sibling panel. Reports raw
 * pixel deltas via `onResize`; the caller clamps and persists. Reusable
 * across the editor (and anywhere else); no store, no domain knowledge.
 *
 * Visual: 6px bar that highlights on hover/active. A short centred pill
 * provides an affordance hint without dominating the chrome.
 */
export function ResizeHandle({
  orientation,
  size,
  direction = 1,
  onResize,
  ariaLabel,
  className,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ start: number; startSize: number } | null>(null);

  const isHorizontal = orientation === 'horizontal';

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      start: isHorizontal ? e.clientY : e.clientX,
      startSize: size,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const current = isHorizontal ? e.clientY : e.clientX;
    const rawDelta = current - dragRef.current.start;
    // `direction === -1` flips the drag-to-grow mapping for handles that
    // sit on the panel's far edge (e.g. drag-up grows a bottom-anchored
    // panel).
    const next = dragRef.current.startSize + direction * rawDelta;
    onResize(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  const baseAxisClasses = isHorizontal
    ? 'h-1.5 w-full cursor-ns-resize'
    : 'w-1.5 h-full cursor-ew-resize';
  const pillWrapperClasses = isHorizontal
    ? 'mx-auto w-10 h-full flex items-center justify-center'
    : 'my-auto h-10 w-full flex items-center justify-center';
  const pillClasses = isHorizontal
    ? 'w-8 h-0.5 rounded-full'
    : 'h-8 w-0.5 rounded-full';

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={
        'group select-none transition-colors ' +
        baseAxisClasses +
        ' ' +
        (dragging ? 'bg-orange-500' : 'bg-border hover:bg-orange-500/60') +
        (className ? ' ' + className : '')
      }
    >
      <div className={pillWrapperClasses}>
        <div
          className={
            pillClasses +
            ' transition-colors ' +
            (dragging ? 'bg-orange-200' : 'bg-gray-500 group-hover:bg-orange-200')
          }
        />
      </div>
    </div>
  );
}
