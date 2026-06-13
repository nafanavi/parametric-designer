import type { CoreAPI } from '@/core/api';
import type { SolidId } from '@/core/types';
import { createStubCore } from '@/core/stub';
import { createCabinetAPI, type CabinetAPI, type DomainContext } from '@/domain/cabinet/api';
import {
  shelfGeometry,
  doorGeometry,
  drawerGeometry,
  type GeometryResult,
} from '@/domain/cabinet/geometry';
import type {
  CabinetNode,
  SceneNode,
} from '@/domain/cabinet/types';
import { instrumentApiCalls } from '@/model/ast/instrument';
import type { SourceRange } from '@/model/ast/types';

/**
 * One narrow mutation seam for shelf/door/drawer geometry recompute during
 * adoption. Encapsulates the writes through `readonly` SceneNode fields so
 * the rest of `adopt()` reads as a typed dispatch.
 */
function applyGeometry<P>(
  node: SceneNode & { params: P },
  next: GeometryResult<P>,
): void {
  const mutable = node as { params: P; solids: readonly SolidId[] };
  mutable.params = next.params;
  mutable.solids = [next.solid];
}

/**
 * Re-derives shelf/door/drawer geometry against a cabinet parent. Each
 * `case` branch narrows `child` to its typed variant — `child.adoptionInput`
 * is the per-type input (e.g. `ShelfInput`), no `as` casts needed inside.
 * Nodes without a `adoptionInput` (panels, frame children, future verticals)
 * pass through untouched.
 */
function recomputeChildGeometry(
  core: CoreAPI,
  parent: CabinetNode,
  child: SceneNode,
): void {
  switch (child.type) {
    case 'shelf':
      if (child.adoptionInput) {
        applyGeometry(child, shelfGeometry(core, child.adoptionInput, parent.params));
      }
      return;
    case 'door':
      if (child.adoptionInput) {
        applyGeometry(child, doorGeometry(core, child.adoptionInput, parent.params));
      }
      return;
    case 'drawer':
      if (child.adoptionInput) {
        applyGeometry(child, drawerGeometry(core, child.adoptionInput, parent.params));
      }
      return;
    default:
      return;
  }
}

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

        // Re-derive geometry for shelf/door/drawer using the parent's params
        // so the child sits inside the cabinet (interior width, depth, y
        // relative to the cabinet floor) instead of in world coordinates.
        // Other node types — panel children of api.cabinet, future custom
        // verticals — carry no adoptionInput and pass through as-is.
        if (parent.type !== 'cabinet') return;
        recomputeChildGeometry(this._core, parent, child);
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
