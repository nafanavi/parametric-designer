import { z } from 'zod';
import type { LLMProvider, ProviderRequest, ProviderResponse } from '../types';

/**
 * Single adapter for every provider that speaks OpenAI's
 * `POST /chat/completions` shape. Swap backends by env vars alone:
 *
 *   LLM_BASE_URL=https://api.groq.com/openai/v1   (Groq)
 *   LLM_BASE_URL=https://api.together.xyz/v1      (Together)
 *   LLM_BASE_URL=https://openrouter.ai/api/v1     (OpenRouter)
 *   LLM_BASE_URL=http://localhost:11434/v1        (Ollama)
 *   LLM_BASE_URL=https://api.openai.com/v1        (OpenAI)
 */

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .nonempty(),
});

export interface OpenAICompatConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Optional override; passed through unchanged. */
  readonly headers?: Record<string, string>;
}

export function createOpenAICompatProvider(config: OpenAICompatConfig): LLMProvider {
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    name: 'openai-compat',
    async generate(req: ProviderRequest, signal): Promise<ProviderResponse> {
      const body = {
        model: req.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
      };

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            ...config.headers,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return {
          kind: 'error',
          status: 0,
          message: err instanceof Error ? err.message : 'Network error',
        };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          kind: 'error',
          status: res.status,
          message: `Provider returned ${res.status}: ${truncate(text, 300)}`,
        };
      }

      const json = await res.json().catch(() => null);
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) {
        return {
          kind: 'error',
          status: 502,
          message: 'Provider returned an unexpected response shape.',
        };
      }

      return { kind: 'text', text: parsed.data.choices[0].message.content };
    },
  };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
