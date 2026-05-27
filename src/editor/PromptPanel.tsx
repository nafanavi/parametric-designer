'use client';

import { useRef, useState } from 'react';
import { useModelStore } from '@/store/modelStore';

const STATUS_COLORS: Record<string, string> = {
  idle: 'text-gray-500',
  pending: 'text-blue-300',
  success: 'text-green-300',
  unavailable: 'text-yellow-300',
  error: 'text-red-300',
};

const MIN_HEIGHT = 140;
const MAX_HEIGHT_RATIO = 0.8; // up to 80% of the window

export function PromptPanel() {
  const setPromptOpen = useModelStore((s) => s.setPromptOpen);
  const submitPrompt = useModelStore((s) => s.submitPrompt);
  const status = useModelStore((s) => s.promptStatus);
  const height = useModelStore((s) => s.promptHeight);
  const setHeight = useModelStore((s) => s.setPromptHeight);

  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const canSubmit = text.trim().length > 0 && status.kind !== 'pending';

  const send = () => {
    if (!canSubmit) return;
    void submitPrompt(text);
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: height };
    setDragging(true);
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY; // drag up → +
    const max = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
    const next = Math.min(max, Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta));
    setHeight(next);
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className="relative z-10 flex flex-col shrink-0 bg-panel-2 shadow-[0_-4px_12px_rgba(0,0,0,0.25)]"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize prompt panel"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className={
          'group h-1.5 cursor-ns-resize select-none transition-colors ' +
          (dragging ? 'bg-orange-500' : 'bg-border hover:bg-orange-500/60')
        }
      >
        <div className="mx-auto w-10 h-full flex items-center justify-center">
          <div
            className={
              'w-8 h-0.5 rounded-full transition-colors ' +
              (dragging ? 'bg-orange-200' : 'bg-gray-500 group-hover:bg-orange-200')
            }
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 h-8 border-b border-border bg-panel">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-orange-400">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xs uppercase tracking-wide text-gray-200 font-medium">Prompt</span>
          <span className="text-[10px] text-gray-500">describe a change — LLM seam</span>
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
        placeholder="e.g. add a 600mm cabinet with two drawers at the bottom"
        spellCheck={false}
        className="flex-1 min-h-0 px-3 py-2 bg-panel text-gray-100 text-sm font-mono leading-relaxed resize-none outline-none"
      />

      <div className="flex items-center justify-between gap-3 px-3 h-11 border-t border-border bg-panel-2">
        <div className={`${STATUS_COLORS[status.kind] ?? 'text-gray-500'} text-xs truncate flex-1`}>
          {status.message ?? 'Type a request and press Apply — or Ctrl/⌘+Enter.'}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setText('')}
            disabled={text.length === 0 || status.kind === 'pending'}
            className="px-3 py-1.5 rounded bg-panel hover:bg-border disabled:bg-panel disabled:text-gray-600 disabled:cursor-not-allowed border border-border text-gray-200 text-sm transition-colors"
          >
            Clear
          </button>
          <button
            onClick={send}
            disabled={!canSubmit}
            className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {status.kind === 'pending' ? 'Generating…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
