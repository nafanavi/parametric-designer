import type { RunResult } from '@/model/runtime';
import type { SceneNode } from '@/domain/cabinet/types';
import { queryOf } from '@/model/scene/query';

/**
 * Byte-range of the single contiguous change between two source strings.
 * The shortest common prefix + the shortest common suffix bound the change;
 * what's in between is the actual edit on each side.
 *
 * For typical edits (one param value flipped, one child removed) the result
 * tightly localises the change. For multi-region edits (an LLM rewrite that
 * touches several places) it returns the union envelope — which is the
 * conservative thing to do: positions inside the envelope are treated as
 * "may have moved" and re-resolve falls back to containment matching.
 */
export interface EditDelta {
  readonly start: number;
  readonly oldEnd: number;
  readonly newEnd: number;
}

export function computeEditDelta(prev: string, next: string): EditDelta | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  let prevEnd = prev.length;
  let newEnd = next.length;
  while (
    prevEnd > start &&
    newEnd > start &&
    prev.charCodeAt(prevEnd - 1) === next.charCodeAt(newEnd - 1)
  ) {
    prevEnd--;
    newEnd--;
  }
  return { start, oldEnd: prevEnd, newEnd };
}

/**
 * Maps a previously-selected node forward through a fresh `RunResult`.
 *
 * Ids in this codebase are anchored to `sourceRange.start` of the node's
 * `api.X(...)` call (see `makeId` in `src/domain/cabinet/api.ts`). After a
 * source mutation the selected node's `start` may:
 *
 *   1. Stay put — the edit happened entirely AFTER the selected node (an
 *      action-button append, a sibling cabinet's children edit). Match by
 *      old start.
 *   2. Shift by a known delta — the edit happened entirely BEFORE the
 *      selected node (deleting a sibling earlier in the source). With the
 *      `delta` argument we translate the expected new start forward by
 *      `(newEnd - oldEnd)`.
 *   3. Fall inside the edited region — the node may be gone, wrapped, or
 *      rewritten. Fall back to containment matching, then null.
 *
 * Without `delta` we behave conservatively: only the exact-old-start match
 * is attempted before containment. That's the "I don't know what changed"
 * fallback (used by `setSource` from the debug textarea or by the LLM
 * regenerate path).
 */
export function reresolveSelection(
  prevSelectedNode: SceneNode | null,
  next: RunResult,
  delta?: EditDelta | null,
): string | null {
  if (!prevSelectedNode?.sourceRange) return null;
  const oldStart = prevSelectedNode.sourceRange.start;
  const q = queryOf(next);

  // Decide where to LOOK in the new source.
  let expectedStart: number | null = oldStart;
  if (delta) {
    if (oldStart < delta.start) {
      // Edit happened entirely after — position unchanged.
      expectedStart = oldStart;
    } else if (oldStart >= delta.oldEnd) {
      // Edit happened entirely before — shift by the size delta.
      expectedStart = oldStart + (delta.newEnd - delta.oldEnd);
    } else {
      // Edit overlapped the selected node — it may be gone or rewritten.
      expectedStart = null;
    }
  }

  // 1) Exact start + type match at the expected position.
  if (expectedStart !== null) {
    for (const id of q.allIds()) {
      const n = q.getNode(id)!;
      if (n.type === prevSelectedNode.type && n.sourceRange?.start === expectedStart) {
        return id;
      }
    }
  }

  // 2) Containment fallback: smallest range that brackets `expectedStart`
  //    (or `oldStart` when we couldn't translate). Useful for wrap-edits
  //    (e.g. the LLM moved the selected node inside a new ancestor call).
  const probe = expectedStart ?? oldStart;
  let best: SceneNode | null = null;
  for (const id of q.allIds()) {
    const n = q.getNode(id)!;
    const r = n.sourceRange;
    if (!r) continue;
    if (r.start <= probe && probe < r.end) {
      const bestR = best?.sourceRange;
      if (!bestR || (r.end - r.start) < (bestR.end - bestR.start)) {
        best = n;
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Promotes a clicked node to the conceptual unit the user actually wants to
 * select. Walks parents while the child's `sourceRange.start` equals its
 * parent's — that's the marker that the child is an internal piece of the
 * parent's call (e.g. a frame panel emitted by `api.cabinet(...)` shares the
 * cabinet's range). Stops at the first ancestor with a distinct range.
 *
 * For a click on a top-level node, or a click on a child whose source range
 * differs from its parent (a nested `api.shelf(...)` inside a cabinet's
 * `children: [...]`), this returns the clicked id unchanged.
 */
export function promoteToConceptualOwner(
  clickedId: string,
  result: RunResult,
): string {
  const q = queryOf(result);
  let cur = q.getNode(clickedId);
  if (!cur?.sourceRange) return clickedId;
  let curStart = cur.sourceRange.start;

  while (cur.parentId !== null) {
    const parent = q.getNode(cur.parentId);
    if (!parent?.sourceRange) return cur.id;
    if (parent.sourceRange.start !== curStart) return cur.id;
    cur = parent;
    curStart = parent.sourceRange.start;
  }
  return cur.id;
}
