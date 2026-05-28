/**
 * Browser-side LLM facade. Posts to /api/generate so the API key never leaves
 * the server. The route handler decides which provider/model is in use —
 * swapping providers does not touch this file or the UI.
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
  let res: Response;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  const json = (await res.json().catch(() => null)) as ModelGenerationResult | null;
  if (!json || typeof json !== 'object' || !('status' in json)) {
    return { status: 'error', message: `Bad response from /api/generate (HTTP ${res.status}).` };
  }
  return json;
}
