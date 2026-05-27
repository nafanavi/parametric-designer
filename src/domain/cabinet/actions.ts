/**
 * Action functions return expression trees describing edits to the source code.
 * The editor materializes them into actual source mutations.
 *
 * For the scratch we use a minimal `SourceEdit` instead of a full AST — enough
 * to demonstrate that pressing an action button modifies the underlying source.
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
        `  api.cabinet({\n` +
        `    width: param('w2', 600),\n` +
        `    height: param('h2', 1800),\n` +
        `    depth: param('d2', 400),\n` +
        `    thickness: 18,\n` +
        `    shelves: 3,\n` +
        `    doors: 1,\n` +
        `    position: [900, 0, 0],\n` +
        `  });\n`,
    }),
  },
  {
    id: 'add-drawer',
    label: 'Add Drawer',
    group: 'create',
    run: () => ({
      kind: 'append',
      code:
        `  api.drawer({\n` +
        `    width: 560,\n` +
        `    height: 180,\n` +
        `    depth: 380,\n` +
        `    position: [0, 120, 0],\n` +
        `  });\n`,
    }),
  },
];
