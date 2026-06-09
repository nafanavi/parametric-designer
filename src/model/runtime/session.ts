import type { CoreAPI } from '@/core/api';
import { createStubCore } from '@/core/stub';
import { createCabinetAPI, type CabinetAPI, type DomainContext } from '@/domain/cabinet/api';
import type { SceneNode } from '@/domain/cabinet/types';
import { instrumentApiCalls } from '@/model/ast/instrument';
import type { SourceRange } from '@/model/ast/types';

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
 * counter, the current source range being evaluated, and any caught error.
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
  /**
   * Source range of the `api.X(...)` call currently being evaluated.
   * Set/cleared by the `__withLoc` wrapper injected by `instrumentApiCalls`.
   * `null` when running uninstrumented source (e.g. tests that call the API
   * directly without going through the runtime).
   */
  private _currentSourceRange: SourceRange | null = null;

  readonly api: CabinetAPI;
  readonly param: (name: string, defaultValue: number) => number;

  constructor() {
    const ctx: DomainContext = {
      core: this._core,
      nextCall: () => ++this._callCounter,
      collect: (node, parent) => {
        if (parent) {
          (parent.children as SceneNode[]).push(node);
          (node as { parentId: string | null }).parentId = parent.id;
        } else {
          this._nodes.push(node);
        }
        return node;
      },
      adopt: (parent, child) => {
        if (child.parentId !== null) {
          throw new Error(
            `Node ${child.id} is already a child of ${child.parentId} — a SceneNode cannot have two parents.`,
          );
        }
        const idx = this._nodes.indexOf(child);
        if (idx >= 0) this._nodes.splice(idx, 1);
        (parent.children as SceneNode[]).push(child);
        (child as { parentId: string | null }).parentId = parent.id;
      },
      currentSourceRange: () => this._currentSourceRange,
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
   * Evaluates the user's source in this session. The source is first
   * instrumented so every `api.X(...)` call is wrapped with `__withLoc`,
   * which sets `_currentSourceRange` before the call runs and restores it
   * after. Errors are captured into `error` rather than thrown.
   */
  run(source: string): void {
    const instrumented = instrumentApiCalls(source);

    // Stack-safe save/restore so nested api calls (e.g. `api.cabinet({
    // foo: api.helper() })`) report the right range for each.
    const withLoc = <T>(start: number, end: number, fn: () => T): T => {
      const prev = this._currentSourceRange;
      this._currentSourceRange = { start, end };
      try {
        return fn();
      } finally {
        this._currentSourceRange = prev;
      }
    };

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('api', 'param', '__withLoc', instrumented);
      fn(this.api, this.param, withLoc);
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
