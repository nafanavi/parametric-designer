'use client';

import { useRef, useState } from 'react';
import { useModelStore } from '@/store/modelStore';
import { ResizeHandle } from '@/components/ResizeHandle';

const STATUS_COLORS: Record<string, string> = {
  idle: 'text-gray-500',
  pending: 'text-blue-300',
  success: 'text-green-300',
  unavailable: 'text-yellow-300',
  error: 'text-red-300',
};

const MIN_HEIGHT = 140;
const MIN_SOURCE_HEIGHT = 80; // leave this much for whatever sits above

export function PromptPanel() {
  const setPromptOpen = useModelStore((s) => s.setPromptOpen);
  const submitPrompt = useModelStore((s) => s.submitPrompt);
  const status = useModelStore((s) => s.promptStatus);
  const height = useModelStore((s) => s.promptHeight);
  const setHeight = useModelStore((s) => s.setPromptHeight);

  const rootRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  const canSubmit = text.trim().length > 0 && status.kind !== 'pending';

  const send = () => {
    if (!canSubmit) return;
    void submitPrompt(text);
  };

  // Clamp the proposed height to [MIN_HEIGHT, container_max]. ResizeHandle
  // is dumb on purpose; constraint logic stays here where it has the
  // context (this panel's parent column height, its min, the sibling's
  // min reserve).
  const clampHeight = (next: number): number => {
    const column = rootRef.current?.parentElement;
    const colHeight = column?.clientHeight ?? window.innerHeight;
    const max = Math.max(MIN_HEIGHT, colHeight - MIN_SOURCE_HEIGHT);
    return Math.min(max, Math.max(MIN_HEIGHT, next));
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col shrink-0 bg-panel-2"
      style={{ height }}
    >
      {/* Handle sits on the panel's TOP edge; dragging UP grows the panel,
          so `direction: -1` flips raw deltaY into "grow this height". */}
      <ResizeHandle
        orientation="horizontal"
        size={height}
        direction={-1}
        onResize={(next) => setHeight(clampHeight(next))}
        ariaLabel="Resize prompt panel"
      />

      <div className="flex items-center justify-between px-3 h-8 border-b border-border bg-panel">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-orange-400 shrink-0">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xs uppercase tracking-wide text-gray-200 font-medium">Prompt</span>
        </div>
        <button
          onClick={() => setPromptOpen(false)}
          className="text-gray-400 hover:text-gray-100 text-lg leading-none px-2 -mr-1"
          aria-label="Close prompt panel"
        >
          ×
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Describe a change to the model…"
        spellCheck={false}
        className="flex-1 min-h-0 px-3 py-2 bg-panel text-gray-100 text-sm font-mono leading-relaxed resize-none outline-none"
      />

      <div className="flex flex-col gap-2 px-3 py-2 border-t border-border bg-panel-2">
        <div className={`${STATUS_COLORS[status.kind] ?? 'text-gray-500'} text-[11px] leading-snug line-clamp-2`}>
          {status.message ?? 'Press Apply — or Ctrl/⌘+Enter.'}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setText('')}
            disabled={text.length === 0 || status.kind === 'pending'}
            className="px-3 py-1 rounded bg-panel hover:bg-border disabled:bg-panel disabled:text-gray-600 disabled:cursor-not-allowed border border-border text-gray-200 text-sm transition-colors"
          >
            Clear
          </button>
          <button
            onClick={send}
            disabled={!canSubmit}
            className="px-3 py-1 rounded bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {status.kind === 'pending' ? 'Generating…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
