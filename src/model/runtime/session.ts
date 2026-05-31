import type { CoreAPI } from '@/core/api';
import { createStubCore } from '@/core/stub';
import { createCabinetAPI, type CabinetAPI, type DomainContext } from '@/domain/cabinet/api';
import type { SceneNode } from '@/domain/cabinet/types';

export interface ParamDef {
  readonly name: string;
  readonly value: number;
}

export interface RunResult {
  readonly nodes: readonly SceneNode[];
  readonly params: ReadonlyMap<string, ParamDef>;
  readonly core: CoreAPI;
  readonly error?: string;
}

/**
 * Owns the state that an evaluation accumulates: the BREP kernel, the
 * registered `param()` registry, the collected scene nodes, the call
 * counter, and any caught error. Replaces the naked closures that used to
 * live inside `runModel`.
 *
 * Lifecycle: one session per model evaluation. Construct, `run(source)`,
 * then read `snapshot()`. The session is single-use — re-running would
 * pollute the existing nodes/params.
 */
export class ModelEvaluationSession {
  private readonly _core: CoreAPI = createStubCore();
  private readonly _params = new Map<string, ParamDef>();
  private readonly _nodes: SceneNode[] = [];
  private _callCounter = 0;
  private _error?: string;

  readonly api: CabinetAPI;
  readonly param: (name: string, defaultValue: number) => number;

  constructor() {
    const ctx: DomainContext = {
      core: this._core,
      nextCall: () => ++this._callCounter,
      collect: (node) => {
        this._nodes.push(node);
        return node;
      },
    };
    this.api = createCabinetAPI(ctx);
    this.param = (name, defaultValue) => {
      if (!this._params.has(name)) {
        this._params.set(name, { name, value: defaultValue });
      }
      return this._params.get(name)!.value;
    };
  }

  /**
   * Evaluates the user's source in this session. Errors are captured into
   * `error` rather than thrown — callers downstream of the runtime always
   * receive a usable `RunResult`.
   */
  run(source: string): void {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('api', 'param', source);
      fn(this.api, this.param);
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  snapshot(): RunResult {
    return {
      nodes: this._nodes,
      params: this._params,
      core: this._core,
      ...(this._error ? { error: this._error } : {}),
    };
  }
}
