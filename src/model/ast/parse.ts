import { Parser, type Node } from 'acorn';

/**
 * Centralised acorn config. We accept the latest ES syntax and ask for
 * source positions so callers can do byte-level edits without re-scanning.
 *
 * Returns `null` instead of throwing for callers that just want a best-effort
 * pass (e.g. the param-rewriter — a half-typed source in the editor textarea
 * shouldn't crash the panel).
 */
export function parseSource(source: string): Node | null {
  try {
    return Parser.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      ranges: true,
      allowReturnOutsideFunction: true,
    });
  } catch {
    return null;
  }
}
