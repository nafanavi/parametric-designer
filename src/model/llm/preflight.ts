/**
 * Cheap server-side checks that run before we burn an LLM call. Anything we
 * can decide deterministically belongs here, not in the model.
 */

/**
 * Returns true if the prompt clearly references a selection. We keep the
 * patterns narrow on purpose — false positives mean we'd reject prompts the
 * model could actually handle. False negatives just fall through to the
 * LLM, which is fine.
 */
export function referencesSelection(prompt: string): boolean {
  return /\b(selected|the\s+selection|this\s+(?:one|panel|cabinet|shelf|door|drawer)|that\s+(?:one|panel|cabinet|shelf|door|drawer))\b/i.test(
    prompt,
  );
}

export interface PreflightUnavailable {
  readonly kind: 'unavailable';
  readonly message: string;
}

/**
 * Returns `null` to proceed, or a structured reason to short-circuit the
 * route with a `unavailable` response — no LLM call made.
 */
export function preflight(
  prompt: string,
  selectionId: string | null,
): PreflightUnavailable | null {
  if (referencesSelection(prompt) && !selectionId) {
    return {
      kind: 'unavailable',
      message: 'Nothing is selected. Click a part in the viewport, then try again.',
    };
  }
  return null;
}
