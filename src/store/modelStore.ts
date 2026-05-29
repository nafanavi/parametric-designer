'use client';

import { create } from 'zustand';
import { EXAMPLE_MODEL_SOURCE } from '@/model/example';
import { runModel, type ParamDef, type RunResult } from '@/model/runtime';
import { rewriteParamDefault, hasRewritableParam } from '@/model/rewrite';
import { generateModel } from '@/model/llm';
import type { SourceEdit } from '@/domain/cabinet/actions';

export interface PromptStatus {
  readonly kind: 'idle' | 'pending' | 'success' | 'unavailable' | 'error';
  readonly message?: string;
}

interface ModelState {
  source: string;
  selection: string | null;
  result: RunResult;

  promptOpen: boolean;
  promptStatus: PromptStatus;
  promptHeight: number;

  setSource: (source: string) => void;
  setParam: (name: string, value: number) => void;
  select: (nodeId: string | null) => void;
  applyEdit: (edit: SourceEdit) => void;

  togglePrompt: () => void;
  setPromptOpen: (open: boolean) => void;
  setPromptHeight: (height: number) => void;
  submitPrompt: (text: string) => Promise<void>;
}

const initialResult = runModel(EXAMPLE_MODEL_SOURCE);

export const useModelStore = create<ModelState>((set, get) => ({
  source: EXAMPLE_MODEL_SOURCE,
  selection: null,
  result: initialResult,

  promptOpen: false,
  promptStatus: { kind: 'idle' },
  promptHeight: 240,

  setSource: (source) => {
    set({ source, result: runModel(source) });
  },

  setParam: (name, value) => {
    const { source } = get();
    if (!hasRewritableParam(source, name)) {
      return;
    }
    const next = rewriteParamDefault(source, name, value);
    set({ source: next, result: runModel(next) });
  },

  select: (nodeId) => set({ selection: nodeId }),

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
}));

export type { ParamDef };
