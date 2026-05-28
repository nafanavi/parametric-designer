import { z } from 'zod';
import { NextResponse } from 'next/server';
import { generateText, APICallError } from 'ai';
import { selectProvider, ProviderConfigError } from '@/model/llm/providers';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/model/llm/prompt';
import { extractCode } from '@/model/llm/extract';
import type { ModelGenerationResult } from '@/model/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  currentSource: z.string().max(100_000),
});

const DEFAULT_TIMEOUT_MS = 30_000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ModelGenerationResult>(
      { status: 'error', message: 'Invalid request: ' + parsed.error.message },
      { status: 400 },
    );
  }

  let selection;
  try {
    selection = selectProvider();
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      return NextResponse.json<ModelGenerationResult>(
        { status: 'unavailable', message: err.message },
        { status: 503 },
      );
    }
    throw err;
  }

  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const { text } = await generateText({
      model: selection.model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(parsed.data.currentSource, parsed.data.prompt),
      temperature: 0.2,
      abortSignal: ac.signal,
    });

    const source = extractCode(text);
    if (!source) {
      return NextResponse.json<ModelGenerationResult>(
        { status: 'error', message: 'Provider returned an empty response.' },
        { status: 502 },
      );
    }

    return NextResponse.json<ModelGenerationResult>({
      status: 'success',
      source,
      message: `Updated by ${selection.providerName}:${selection.modelId}.`,
    });
  } catch (err) {
    return NextResponse.json<ModelGenerationResult>(mapError(err, timeoutMs), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function mapError(err: unknown, timeoutMs: number): ModelGenerationResult {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    const kind: ModelGenerationResult['status'] =
      status >= 400 && status < 500 ? 'unavailable' : 'error';
    return { status: kind, message: `Provider returned ${status || '?'}: ${err.message}` };
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { status: 'error', message: `Provider timed out after ${timeoutMs}ms.` };
  }
  return {
    status: 'error',
    message: err instanceof Error ? err.message : String(err),
  };
}
