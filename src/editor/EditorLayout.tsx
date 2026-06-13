'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useModelStore } from '@/store/modelStore';
import { ActionToolbar } from './ActionToolbar';
import { SourcePanel } from './SourcePanel';
import { PropertyPanel } from './PropertyPanel';
import { PromptPanel } from './PromptPanel';
import { CatalogPanel } from './CatalogPanel';
import { ResizeHandle } from '@/components/ResizeHandle';

// Minimum column widths in pixels. Below this the panels stop being
// useful (source code wraps too tightly, property labels truncate).
const MIN_SOURCE_PANEL_WIDTH = 220;
const MIN_PROPERTY_PANEL_WIDTH = 220;
// Reserve at least this much for the viewport between the two side panels.
const MIN_VIEWPORT_WIDTH = 320;

const Scene = dynamic(() => import('@/viewer/Scene').then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
      Loading viewport…
    </div>
  ),
});

export function EditorLayout() {
  const promptOpen = useModelStore((s) => s.promptOpen);
  const catalogOpen = useModelStore((s) => s.catalogOpen);
  const toggleCatalog = useModelStore((s) => s.toggleCatalog);
  const sourcePanelWidth = useModelStore((s) => s.sourcePanelWidth);
  const propertyPanelWidth = useModelStore((s) => s.propertyPanelWidth);
  const setSourcePanelWidth = useModelStore((s) => s.setSourcePanelWidth);
  const setPropertyPanelWidth = useModelStore((s) => s.setPropertyPanelWidth);

  // Clamp factory: keeps the panel within its own min and leaves enough
  // room for the viewport + the OTHER panel. We compute the available
  // window width once per call rather than tracking it in state — resizes
  // are user-driven and recompute every drag tick anyway.
  const clampSourceWidth = (proposed: number): number => {
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600;
    const max = Math.max(
      MIN_SOURCE_PANEL_WIDTH,
      viewport - propertyPanelWidth - MIN_VIEWPORT_WIDTH,
    );
    return Math.min(max, Math.max(MIN_SOURCE_PANEL_WIDTH, proposed));
  };
  const clampPropertyWidth = (proposed: number): number => {
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600;
    const max = Math.max(
      MIN_PROPERTY_PANEL_WIDTH,
      viewport - sourcePanelWidth - MIN_VIEWPORT_WIDTH,
    );
    return Math.min(max, Math.max(MIN_PROPERTY_PANEL_WIDTH, proposed));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing inside the source/prompt textareas, property-panel
      // number inputs, or any contentEditable region.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const state = useModelStore.getState();
      if (!state.selection) return;

      // Escape clears selection (dismisses the floating action toolbar).
      // The Scene installs its own Escape handler while a drag is active,
      // which runs first and tears down the drag without touching selection;
      // by the time this fires, only the post-drag selection is at stake.
      if (e.key === 'Escape') {
        e.preventDefault();
        state.select(null);
        return;
      }
      // Forward-Delete on full keyboards; Backspace covers Mac laptops, whose
      // only "delete" key emits 'Backspace'.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      state.deleteSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-panel text-gray-100">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-panel-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-orange-400" />
          <h1 className="text-sm font-semibold">buerli — Cabinet Studio</h1>
          <span className="text-[10px] uppercase tracking-wide text-gray-500 ml-2">
            scratch
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleCatalog}
            className={
              'text-[11px] px-2 py-1 rounded-md border border-border ' +
              'hover:border-orange-400/60 transition-colors ' +
              (catalogOpen ? 'bg-panel border-orange-400 text-orange-300' : 'text-gray-300')
            }
            aria-pressed={catalogOpen}
          >
            {catalogOpen ? 'Hide catalog' : 'Show catalog'}
          </button>
          <div className="text-[10px] text-gray-500">
            CoreAPI: stub (BREP kernel pending)
          </div>
        </div>
      </header>

      <ActionToolbar />

      <main className="flex flex-1 min-h-0">
        {/* Left column: source + (optional) prompt panel. */}
        <div
          className="flex flex-col min-h-0 shrink-0"
          style={{ width: sourcePanelWidth }}
        >
          <div className="flex-1 min-h-0">
            <SourcePanel />
          </div>
          {promptOpen && <PromptPanel />}
        </div>

        <ResizeHandle
          orientation="vertical"
          size={sourcePanelWidth}
          onResize={(next) => setSourcePanelWidth(clampSourceWidth(next))}
          ariaLabel="Resize source panel"
        />

        {/* Viewport — fills remaining space. */}
        <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
          <Scene />
        </div>

        {/* The right column's resize handle sits on the column's LEFT edge,
            so dragging RIGHT shrinks the panel (direction: -1). */}
        <ResizeHandle
          orientation="vertical"
          size={propertyPanelWidth}
          direction={-1}
          onResize={(next) => setPropertyPanelWidth(clampPropertyWidth(next))}
          ariaLabel="Resize property panel"
        />

        {/* PropertyPanel and CatalogPanel share the right column. When the
            catalog is open it overlays the property panel; no layout shift,
            and closing the catalog reveals the panel underneath unchanged.
            While open, the catalog absorbs pointer events on its inset-0
            overlay, so the resize handle is effectively disabled — that's
            acceptable: the catalog is a modal sidebar state. */}
        <div
          className="relative min-h-0 shrink-0"
          style={{ width: propertyPanelWidth }}
        >
          <PropertyPanel />
          {catalogOpen && (
            <div className="absolute inset-0 z-10">
              <CatalogPanel />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
