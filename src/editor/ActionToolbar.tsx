'use client';

import { useModelStore } from '@/store/modelStore';

export function ActionToolbar() {
  const promptOpen = useModelStore((s) => s.promptOpen);
  const togglePrompt = useModelStore((s) => s.togglePrompt);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-panel-2">
      <button
        onClick={togglePrompt}
        className={
          'ml-auto px-3 py-1 text-sm rounded border text-gray-100 ' +
          (promptOpen
            ? 'bg-orange-600 hover:bg-orange-500 border-orange-500'
            : 'bg-panel hover:bg-border border-border')
        }
        aria-pressed={promptOpen}
      >
        {promptOpen ? 'Hide Prompt' : 'Prompt'}
      </button>
    </div>
  );
}
