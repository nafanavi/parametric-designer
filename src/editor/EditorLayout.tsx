'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useModelStore } from '@/store/modelStore';
import { ActionToolbar } from './ActionToolbar';
import { SourcePanel } from './SourcePanel';
import { PropertyPanel } from './PropertyPanel';
import { PromptPanel } from './PromptPanel';

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
  const isRepairing = useModelStore((s) => s.isRepairing);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      // Don't hijack Delete inside the source/prompt textareas, property-
      // panel number inputs, or any contentEditable region.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const state = useModelStore.getState();
      if (!state.selection) return;

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
        <div className="text-[10px] text-gray-500">
          CoreAPI: stub (BREP kernel pending)
        </div>
      </header>

      <ActionToolbar />

      <main
        className="grid flex-1 min-h-0"
        style={{ gridTemplateColumns: '320px 1fr 280px' }}
      >
        <div className="flex flex-col min-h-0 border-r border-border">
          <div className="flex-1 min-h-0">
            <SourcePanel />
          </div>
          {promptOpen && <PromptPanel />}
        </div>
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <Scene />
          {isRepairing && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px] pointer-events-none"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-panel-2/90 border border-border shadow-lg">
                <span className="w-3 h-3 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
                <span className="text-xs text-gray-200">Updating…</span>
              </div>
            </div>
          )}
        </div>
        <PropertyPanel />
      </main>
    </div>
  );
}
