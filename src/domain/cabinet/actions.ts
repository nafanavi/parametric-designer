/**
 * Action functions return expression trees describing edits to the source code.
 * The editor materializes them into actual source mutations.
 *
 * For the scratch we use a minimal `SourceEdit` instead of a full AST — enough
 * to demonstrate that pressing an action button modifies the underlying source.
 *
 * Now that parts compose by nesting (a cabinet owns its children inline), an
 * "Add Cabinet" button can append a self-contained snippet with no need for
 * a fresh `const` binding. Action functions that need to MODIFY an existing
 * cabinet's children array still need AST-aware editing — those land with
 * the drag-and-drop work in a future PR.
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
        `\napi.cabinet({\n` +
        `  width: param('w2', 600),\n` +
        `  height: param('h2', 1800),\n` +
        `  depth: param('d2', 400),\n` +
        `  thickness: 18,\n` +
        `  position: [-1000, 0, 0],\n` +
        `  children: [\n` +
        `    api.door({ side: 'full' }),\n` +
        `  ],\n` +
        `});\n`,
    }),
  },
];
