'use client';

import { useModelStore } from '@/store/modelStore';
import { CATALOG_ITEMS } from './catalog';

/**
 * Right-side catalog sidebar. Each tile arms a catalog drag on pointerdown
 * — the Scene then takes over (tracking the cursor, drawing a 3D ghost on
 * the floor plane, and appending a top-level call on canvas pointerup).
 *
 * The tiles use pointerdown rather than HTML5 drag-and-drop so the rest of
 * the drag flow can ride on the same pointer/raycast infrastructure as the
 * in-scene "drag selected" gesture. See `Scene.tsx` for the cursor-tracking
 * window listeners that activate when `catalogDrag` is set.
 */
export function CatalogPanel() {
  const startCatalogDrag = useModelStore((s) => s.startCatalogDrag);
  const activeDragId = useModelStore((s) => s.catalogDrag?.itemId ?? null);

  return (
    <aside className="flex flex-col min-h-0 border-l border-border bg-panel-2">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h2 className="text-xs uppercase tracking-wide text-gray-400">Catalog</h2>
        <span className="text-[10px] text-gray-500">{CATALOG_ITEMS.length} items</span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 overflow-y-auto">
        {CATALOG_ITEMS.map((item) => {
          const active = activeDragId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              // pointerdown arms the drag immediately so the cursor moves
              // straight into "tracking" mode — no extra click required.
              onPointerDown={(e) => {
                e.preventDefault();
                startCatalogDrag(item.id);
              }}
              className={
                'flex flex-col items-center gap-1 p-2 rounded-md border ' +
                'border-border bg-panel hover:border-orange-400/60 ' +
                'transition-colors text-gray-200 ' +
                (active ? 'border-orange-400 ring-1 ring-orange-400/50' : '')
              }
              aria-label={`Drag ${item.label} onto the scene`}
            >
              <item.Icon className="w-10 h-10" />
              <span className="text-[11px]">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-auto px-3 py-2 text-[10px] text-gray-500 border-t border-border">
        Press &amp; drag onto the viewport. Release to drop.
      </div>
    </aside>
  );
}
