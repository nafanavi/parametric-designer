import type { LLMProvider } from '../types';
import { createOpenAICompatProvider } from './openai-compatible';

export interface ProviderEnv {
  readonly LLM_PROVIDER?: string;
  readonly LLM_BASE_URL?: string;
  readonly LLM_API_KEY?: string;
  readonly LLM_MODEL?: string;
}

export interface ProviderSelection {
  readonly provider: LLMProvider;
  readonly model: string;
}

/**
 * Reads server-side env vars and returns the configured provider plus the
 * model name to send. Throws with an actionable message if required vars are
 * missing — the route handler converts that into a 503 with the message.
 */
export function selectProvider(env: ProviderEnv = process.env as ProviderEnv): ProviderSelection {
  const kind = env.LLM_PROVIDER?.trim() || 'openai-compat';

  switch (kind) {
    case 'openai-compat': {
      const baseUrl = required(env.LLM_BASE_URL, 'LLM_BASE_URL');
      const apiKey = required(env.LLM_API_KEY, 'LLM_API_KEY');
      const model = required(env.LLM_MODEL, 'LLM_MODEL');
      return {
        provider: createOpenAICompatProvider({ baseUrl, apiKey }),
        model,
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
