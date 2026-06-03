/**
 * Half-open byte range `[start, end)` into the model source string. Same
 * convention acorn uses for `node.start` / `node.end`.
 *
 * Used to anchor SceneNodes back to the source call that produced them,
 * which is the substrate for drag-to-rewrite, Puck-style call-site editing,
 * and "edit at this line" LLM tooling.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}
