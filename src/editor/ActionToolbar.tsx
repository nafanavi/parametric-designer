'use client';

import { cabinetActions } from '@/domain/cabinet/actions';
import { useModelStore } from '@/store/modelStore';

export function ActionToolbar() {
  const applyEdit = useModelStore((s) => s.applyEdit);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-panel-2">
      <span className="text-xs uppercase tracking-wide text-gray-400 mr-2">Actions</span>
      {cabinetActions.map((action) => (
        <button
          key={action.id}
          onClick={() => applyEdit(action.run())}
          className="px-3 py-1 text-sm rounded bg-panel hover:bg-border border border-border text-gray-100"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
