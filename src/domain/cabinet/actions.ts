/**
 * Action functions return expression trees describing edits to the source code.
 * The editor materializes them into actual source mutations.
 *
 * For the scratch we use a minimal `SourceEdit` instead of a full AST — enough
 * to demonstrate that pressing an action button modifies the underlying source.
 *
 * TODO(actions-revisit): with the compositional cabinet API (frame +
 * `{ in: cab }` children), "action button → append snippet" is a thin demo at
 * best. The snippet has to introduce a fresh `const` binding so subsequent
 * api.shelf/api.door calls can reference the new cabinet, which is fragile
 * (name collisions, scope issues) without proper AST-aware insertion.
 *
 * Decide before the next iteration: either
 *   (a) refactor actions to emit STRUCTURED edits (insert/replace/delete
 *       calls) backed by the AST module, so each action knows what to attach
 *       and where — much richer than the current string `append`/`replace`.
 *   (b) drop the action toolbar entirely — the LLM prompt panel + the
 *       property panel cover the same ground more flexibly, and the only
 *       remaining "Add Cabinet" template is barely earning its place.
 *
 * For now: only one action ("Add Cabinet"), updated to the new compositional
 * API. The previous "Add Drawer" template needed a parent reference we can't
 * conjure from a pure-append edit, so it's removed.
 */

export type SourceEdit =
  | { readonly kind: 'append'; readonly code: string }
  | { readonly kind: 'replace'; readonly match: string; readonly with: string };

export interface Action {
  readonly id: string;
  readonly label: string;
  readonly group: 'create' | 'modify';
  run(): SourceEdit;
}

export const cabinetActions: readonly Action[] = [
  {
    id: 'add-cabinet',
    label: 'Add Cabinet',
    group: 'create',
    run: () => ({
      kind: 'append',
      code:
        `\nconst extraCab = api.cabinet({\n` +
        `  width: param('w2', 600),\n` +
        `  height: param('h2', 1800),\n` +
        `  depth: param('d2', 400),\n` +
        `  thickness: 18,\n` +
        `  position: [-1000, 0, 0],\n` +
        `});\n` +
        `api.door({ in: extraCab, side: 'full' });\n`,
    }),
  },
];
