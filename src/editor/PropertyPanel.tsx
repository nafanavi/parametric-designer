'use client';

import { useModelStore } from '@/store/modelStore';
import type { SceneNode } from '@/domain/cabinet/types';

function findNode(nodes: readonly SceneNode[], id: string | null): SceneNode | null {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findNode(n.children, id);
    if (child) return child;
  }
  return null;
}

export function PropertyPanel() {
  const result = useModelStore((s) => s.result);
  const setParam = useModelStore((s) => s.setParam);
  const selection = useModelStore((s) => s.selection);

  const selected = findNode(result.nodes, selection);
  const params = Array.from(result.params.values());

  return (
    <div className="flex flex-col h-full border-l border-border bg-panel text-gray-100">
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-400 border-b border-border">
        Parameters
      </div>

      <div className="p-3 space-y-3 overflow-y-auto">
        {params.length === 0 && (
          <div className="text-xs text-gray-500">
            No <code>param(...)</code> declarations in the model.
          </div>
        )}
        {params.map((p) => (
          <div key={p.name} className="space-y-1">
            <label className="text-xs text-gray-300">{p.name}</label>
            <input
              type="number"
              value={p.value}
              step={p.name === 'shelves' ? 1 : 10}
              onChange={(e) => setParam(p.name, Number(e.target.value))}
              className="w-full px-2 py-1 bg-panel-2 border border-border rounded text-sm"
            />
          </div>
        ))}
      </div>

      <div className="border-t border-border px-3 py-2 text-xs uppercase tracking-wide text-gray-400">
        Selection
      </div>
      <div className="p-3 text-xs space-y-2">
        {!selected && <div className="text-gray-500">Pick a part in the viewport.</div>}
        {selected && (
          <>
            <div className="text-gray-200">
              <span className="text-gray-500">type:</span> {selected.type}
            </div>
            <div className="text-gray-200">
              <span className="text-gray-500">id:</span> {selected.id}
            </div>
            <div className="text-gray-200">
              <span className="text-gray-500">call:</span> #{selected.callIndex}
            </div>
            <pre className="bg-panel-2 border border-border rounded p-2 text-[11px] overflow-x-auto">
              {JSON.stringify(selected.params, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
