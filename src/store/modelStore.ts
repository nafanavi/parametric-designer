'use client';

import { create } from 'zustand';
import { EXAMPLE_MODEL_SOURCE } from '@/model/example';
import { runModel, type ParamDef, type RunResult } from '@/model/runtime';
import { rewriteParamDefault, hasRewritableParam } from '@/model/rewrite';
import type { SourceEdit } from '@/domain/cabinet/actions';

interface ModelState {
  source: string;
  selection: string | null;
  result: RunResult;

  setSource: (source: string) => void;
  setParam: (name: string, value: number) => void;
  select: (nodeId: string | null) => void;
  applyEdit: (edit: SourceEdit) => void;
}

const initialResult = runModel(EXAMPLE_MODEL_SOURCE);

export const useModelStore = create<ModelState>((set, get) => ({
  source: EXAMPLE_MODEL_SOURCE,
  selection: null,
  result: initialResult,

  setSource: (source) => {
    set({ source, result: runModel(source) });
  },

  setParam: (name, value) => {
    const { source } = get();
    if (!hasRewritableParam(source, name)) {
      // Param exists in registry but its default isn't a literal — leave the
      // source alone. (e.g. `param('w', 800 + 100)`.)
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
}));

export type { ParamDef };
