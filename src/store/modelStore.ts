'use client';

import { create } from 'zustand';
import { EXAMPLE_MODEL_SOURCE } from '@/model/example';
import { runModel, type ParamDef, type RunResult } from '@/model/runtime';
import { rewriteCallProperty, removeCallStatement } from '@/model/ast/rewrite';
import { generateModel } from '@/model/llm';
import { repairSource } from '@/model/repair';
import { queryOf } from '@/model/scene/query';
import type { SourceEdit } from '@/domain/cabinet/actions';

export interface PromptStatus {
  readonly kind: 'idle' | 'pending' | 'success' | 'unavailable' | 'error';
  readonly message?: string;
}

interface ModelState {
  source: string;
  selection: string | null;
  result: RunResult;

  /**
   * True only while a silent LLM repair is in flight inside `commitSource`.
   * Stays false on the happy path (clean delete/edit) so the viewport never
   * flashes a spinner for sub-millisecond commits. Driven by the store, read
   * by the viewport overlay.
   */
  isRepairing: boolean;

  promptOpen: boolean;
  promptStatus: PromptStatus;
  promptHeight: number;

  setSource: (source: string) => void;
  /**
   * Per-instance edit: rewrites a property of the currently-selected node's
   * source call. If the selected value was a `param(...)` read, the call is
   * decoupled from that param (it now carries a literal). No-op when nothing
   * is selected or the selection has no sourceRange. Async because the
   * commit may invoke a silent LLM repair pass when the edit produces source
   * that throws — see `commitSource`.
   */
  setSelectionParam: (name: string, value: number) => Promise<void>;
  /**
   * Removes the enclosing source statement of the currently-selected node,
   * then clears the selection. No-op when nothing is selected or the
   * selection has no sourceRange. Async for the same reason as
   * `setSelectionParam` — see `commitSource`.
   */
  deleteSelection: () => Promise<void>;
  select: (nodeId: string | null) => void;
  applyEdit: (edit: SourceEdit) => void;

  togglePrompt: () => void;
  setPromptOpen: (open: boolean) => void;
  setPromptHeight: (height: number) => void;
  submitPrompt: (text: string) => Promise<void>;
}

const initialResult = runModel(EXAMPLE_MODEL_SOURCE);

export const useModelStore = create<ModelState>((set, get) => {
  /**
   * Single commit seam for mutating actions (delete, per-instance param edit,
   * future direct-manipulation). Pipeline:
   *
   *   1. If the proposed source equals the current source, no-op.
   *   2. Evaluate proposed. If it runs cleanly, commit (apply onSuccess).
   *   3. If it throws, ask the LLM to repair it once. If repair returns a
   *      source that runs cleanly, commit that instead.
   *   4. Otherwise silently leave previous state in place — the action
   *      "didn't take." onSuccess is NOT applied in this case (selection
   *      stays put, etc.).
   *
   * The LLM repair is invisible to the user. There is no spinner, no error
   * surface; latency is paid only on the rare path where the proposed
   * source actually throws.
   */
  async function commitSource(
    proposed: string,
    onSuccess: Partial<ModelState> = {},
  ): Promise<void> {
    // While a repair is in flight, drop every other mutating action. This is
    // the single gate; per-component wrappers (Scene's select gate, the Delete
    // keydown) are no longer needed. Without this, a second Delete during
    // repair would fire a second /api/repair fetch in parallel and the
    // finally{} blocks would race the isRepairing flag.
    if (get().isRepairing) return;

    const previous = get().source;
    if (proposed === previous) return;

    const result = runModel(proposed);
    if (!result.error) {
      set({ source: proposed, result, ...onSuccess });
      return;
    }

    // Proposed source throws. One LLM repair attempt, then silent revert.
    // The viewport overlay reads `isRepairing` and shows a loader while we
    // wait — only on this rare path, never on the happy path above.
    set({ isRepairing: true });
    try {
      const repair = await repairSource({
        previous,
        proposed,
        error: result.error,
      });
      if (repair.status !== 'success') return;

      const repairedRun = runModel(repair.source);
      if (repairedRun.error) return; // still broken — give up silently

      // Lost-update guard: source may have moved during the await (e.g. the
      // user typed in the debug textarea, which bypasses commitSource on
      // purpose). If it has, this repair is stale — drop it instead of
      // clobbering the user's intermediate edit.
      if (get().source !== previous) return;

      set({ source: repair.source, result: repairedRun, ...onSuccess });
    } finally {
      set({ isRepairing: false });
    }
  }

  return {
  source: EXAMPLE_MODEL_SOURCE,
  selection: null,
  result: initialResult,

  isRepairing: false,

  promptOpen: false,
  promptStatus: { kind: 'idle' },
  promptHeight: 240,

  setSource: (source) => {
    // Debug textarea path. We deliberately do NOT route through commitSource
    // here — the developer is editing source directly and any runtime error
    // is intentional signal, not something to silently repair.
    set({ source, result: runModel(source) });
  },

  setSelectionParam: async (name, value) => {
    const { source, selection, result } = get();
    if (!selection) return;
    const node = queryOf(result).getNode(selection);
    if (!node?.sourceRange) return;
    const next = rewriteCallProperty(source, node.sourceRange, name, value);
    await commitSource(next);
  },

  deleteSelection: async () => {
    const { source, selection, result } = get();
    if (!selection) return;
    const node = queryOf(result).getNode(selection);
    if (!node?.sourceRange) return;
    const next = removeCallStatement(source, node.sourceRange);
    await commitSource(next, { selection: null });
  },

  select: (nodeId) => {
    // Selection changes are also dropped during a repair — keeps the
    // selected part anchored to the in-flight action so the spinner stays
    // pinned and `onSuccess: { selection: null }` clears the right node
    // when the repair lands.
    if (get().isRepairing) return;
    set({ selection: nodeId });
  },

  applyEdit: (edit) => {
    const { source } = get();
    let next = source;
    if (edit.kind === 'append') {
      next = source.replace(/\s*$/, '\n') + edit.code;
    } else if (edit.kind === 'replace') {
      next = source.split(edit.match).join(edit.with);
    }
    set({ source: next, result: runModel(next) });
  },

  togglePrompt: () => set((s) => ({ promptOpen: !s.promptOpen })),
  setPromptOpen: (open) => set({ promptOpen: open }),
  setPromptHeight: (height) => set({ promptHeight: height }),

  submitPrompt: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    set({ promptStatus: { kind: 'pending', message: 'Generating…' } });
    const result = await generateModel({
      prompt: trimmed,
      currentSource: get().source,
      selectionId: get().selection,
    });

    if (result.status === 'success') {
      const run = runModel(result.source);
      // Always update source so the user can hand-fix bad output; surface any
      // runtime error in the prompt status instead of falsely claiming success.
      set({
        source: result.source,
        result: run,
        promptStatus: run.error
          ? { kind: 'error', message: `Generated source has a runtime error: ${run.error}` }
          : { kind: 'success', message: result.message },
      });
    } else {
      set({ promptStatus: { kind: result.status, message: result.message } });
    }
  },
  };
});

export type { ParamDef };
