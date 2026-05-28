/**
 * LLMs sometimes wrap code in markdown fences despite being asked not to.
 * `extractCode` returns the first fenced block if present, otherwise the
 * trimmed input. Always returns something — the caller decides whether the
 * result is runnable.
 */
export function extractCode(raw: string): string {
  const trimmed = raw.trim();

  // ```lang\n...\n``` (lang optional)
  const fenced = /^```(?:[a-zA-Z]+)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
  if (fenced) return fenced[1].trim();

  // Inline-ish: ``` ... ``` anywhere in the response (greedy first).
  const looseFence = /```(?:[a-zA-Z]+)?\s*\n?([\s\S]*?)```/.exec(trimmed);
  if (looseFence) return looseFence[1].trim();

  return trimmed;
}
