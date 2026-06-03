'use client';

import { useMemo } from 'react';
import { useModelStore } from '@/store/modelStore';
import { findCallProperties, type CallProperty } from '@/model/ast/rewrite';
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
  const source = useModelStore((s) => s.source);
  const result = useModelStore((s) => s.result);
  const selection = useModelStore((s) => s.selection);
  const setSelectionParam = useModelStore((s) => s.setSelectionParam);

  const selected = findNode(result.nodes, selection);

  // Editable, source-located properties of the selected call (if any).
  const editable: CallProperty[] = useMemo(() => {
    if (!selected?.sourceRange) return [];
    return findCallProperties(source, selected.sourceRange);
  }, [source, selected]);

  return (
    <div className="flex flex-col h-full border-l border-border bg-panel text-gray-100">
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-400 border-b border-border">
        Selection
      </div>

      <div className="flex-1 p-3 text-xs space-y-3 overflow-y-auto">
        {!selected && (
          <div className="text-gray-500">Pick a part in the viewport to edit its parameters.</div>
        )}

        {selected && (
          <>
            <div className="space-y-0.5 pb-2 border-b border-border">
              <div className="text-gray-200">
                <span className="text-gray-500">type:</span> {selected.type}
              </div>
              <div className="text-gray-200">
                <span className="text-gray-500">id:</span> {selected.id}
              </div>
              <div className="text-gray-200">
                <span className="text-gray-500">call:</span> #{selected.callIndex}
              </div>
            </div>

            {editable.length === 0 && (
              <div className="text-gray-500">
                No editable properties found at this call site (or selection has no sourceRange).
              </div>
            )}

            <div className="space-y-2">
              {editable.map((p) => {
                const editableNumber = p.currentNumber !== null;
                return (
                  <div key={`${p.name}-${p.valueRange.start}`} className="space-y-1">
                    <label className="text-gray-300 flex items-center justify-between">
                      <span>{p.name}</span>
                      {!editableNumber && (
                        <span className="text-[10px] text-gray-600">read-only</span>
                      )}
                    </label>
                    {editableNumber ? (
                      <input
                        type="number"
                        value={p.currentNumber ?? 0}
                        step={10}
                        onChange={(e) => setSelectionParam(p.name, Number(e.target.value))}
                        className="w-full px-2 py-1 bg-panel-2 border border-border rounded text-sm"
                      />
                    ) : (
                      <code className="block w-full px-2 py-1 bg-panel-2 border border-border rounded text-[11px] text-gray-400 overflow-x-auto">
                        {source.slice(p.valueRange.start, p.valueRange.end)}
                      </code>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
