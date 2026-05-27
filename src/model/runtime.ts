import type { CoreAPI } from '@/core/api';
import { createStubCore } from '@/core/stub';
import { createCabinetAPI, type CabinetAPI, type DomainContext } from '@/domain/cabinet/api';
import type { SceneNode } from '@/domain/cabinet/types';

export interface ParamDef {
  readonly name: string;
  /** The literal value `param(name, X)` returned during this run. */
  readonly value: number;
}

export interface RunResult {
  readonly nodes: readonly SceneNode[];
  readonly params: ReadonlyMap<string, ParamDef>;
  readonly core: CoreAPI;
  readonly error?: string;
}

/**
 * Evaluates a parametric model source string. The source is plain JS code
 * with `api` and `param` in scope, e.g.:
 *
 *   api.cabinet({ width: param('width', 800), ... });
 *
 * In a future iteration we'll swap `new Function` for a sandboxed TS evaluator
 * (sucrase/swc transpile + scoped globals) so the source can be true TypeScript.
 *
 * Parameter values come **only** from the source — there is no override layer.
 * Edits to a parameter in the UI rewrite the source via `rewriteParamDefault`.
 */
export function runModel(source: string): RunResult {
  const core = createStubCore();
  const params = new Map<string, ParamDef>();
  const nodes: SceneNode[] = [];
  let callCounter = 0;

  const ctx: DomainContext = {
    core,
    nextCall: () => ++callCounter,
    collect: (node) => {
      nodes.push(node);
      return node;
    },
  };

  const api: CabinetAPI = createCabinetAPI(ctx);
  const param = (name: string, defaultValue: number): number => {
    if (!params.has(name)) {
      params.set(name, { name, value: defaultValue });
    }
    return params.get(name)!.value;
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('api', 'param', source);
    fn(api, param);
    return { nodes, params, core };
  } catch (err) {
    return {
      nodes,
      params,
      core,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
