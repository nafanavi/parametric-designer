import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV1 } from 'ai';

export interface ProviderEnv {
  readonly LLM_PROVIDER?: string;
  readonly LLM_BASE_URL?: string;
  readonly LLM_API_KEY?: string;
  readonly LLM_MODEL?: string;
}

export interface ProviderSelection {
  readonly model: LanguageModelV1;
  readonly modelId: string;
  readonly providerName: string;
}

/**
 * Reads server-side env vars and returns a configured AI SDK model.
 * Throws ProviderConfigError with an actionable message when required vars
 * are missing — the route handler turns that into a 503/`unavailable`.
 *
 * All supported providers go through `@ai-sdk/openai-compatible`, which
 * speaks OpenAI's `/chat/completions` shape. Same env-var matrix as before:
 * Groq, Together, OpenRouter, Ollama, OpenAI — switched by `LLM_BASE_URL`.
 */
export function selectProvider(env: ProviderEnv = process.env as ProviderEnv): ProviderSelection {
  const kind = env.LLM_PROVIDER?.trim() || 'openai-compat';

  switch (kind) {
    case 'openai-compat': {
      const baseURL = required(env.LLM_BASE_URL, 'LLM_BASE_URL');
      const apiKey = required(env.LLM_API_KEY, 'LLM_API_KEY');
      const modelId = required(env.LLM_MODEL, 'LLM_MODEL');

      const provider = createOpenAICompatible({
        name: 'openai-compat',
        baseURL,
        apiKey,
      });

      return {
        model: provider(modelId),
        modelId,
        providerName: 'openai-compat',
      };
    }
    default:
      throw new ProviderConfigError(
        `Unknown LLM_PROVIDER "${kind}". Supported: openai-compat.`,
      );
  }
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

function required(value: string | undefined, name: string): string {
  const v = value?.trim();
  if (!v) {
    throw new ProviderConfigError(
      `Missing required env var ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  return v;
}
