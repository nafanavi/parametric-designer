/**
 * LLM integration seam. Today this is a stub that returns `unavailable`; swap
 * the implementation to a real call (Anthropic SDK, OpenAI, server route)
 * without touching the UI or the store.
 *
 * The contract: `generateModel` takes the user prompt + current source and
 * returns either a new source string to apply, or a message explaining why no
 * change was produced.
 */

export interface ModelGenerationRequest {
  readonly prompt: string;
  readonly currentSource: string;
}

export type ModelGenerationResult =
  | { readonly status: 'success'; readonly source: string; readonly message: string }
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'error'; readonly message: string };

export async function generateModel(
  req: ModelGenerationRequest,
): Promise<ModelGenerationResult> {
  // TODO: wire to a real LLM. The Claude API would be invoked from a Next.js
  // route (so the key stays server-side), then the resulting source returned
  // here. For now we surface the prompt back to the user as confirmation.
  return {
    status: 'unavailable',
    message: `LLM not wired yet. Received prompt: "${truncate(req.prompt, 200)}"`,
  };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
