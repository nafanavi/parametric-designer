/**
 * Provider-side types. These never reach the browser bundle — they describe
 * the contract between the Next.js route and the underlying LLM provider.
 */

export interface ProviderRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly model: string;
}

export type ProviderResponse =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

export interface LLMProvider {
  readonly name: string;
  generate(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}
