import { ModelEvaluationSession } from './runtime/session';

export { ModelEvaluationSession } from './runtime/session';
export type { ParamDef, RunResult } from './runtime/session';

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
export function runModel(source: string) {
  const session = new ModelEvaluationSession();
  session.run(source);
  return session.snapshot();
}
