'use client';

import { useModelStore } from '@/store/modelStore';

export function SourcePanel() {
  const source = useModelStore((s) => s.source);
  const setSource = useModelStore((s) => s.setSource);
  const error = useModelStore((s) => s.result.error);

  return (
    <div className="flex flex-col h-full bg-panel">
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-400 border-b border-border">
        ParametricModel.ts
      </div>
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        spellCheck={false}
        className="flex-1 p-3 bg-panel text-gray-100 font-mono text-xs resize-none outline-none"
      />
      {error && (
        <div className="px-3 py-2 text-xs text-red-300 bg-red-950/40 border-t border-red-900">
          {error}
        </div>
      )}
    </div>
  );
}
