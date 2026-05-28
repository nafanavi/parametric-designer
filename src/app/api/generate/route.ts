import { z } from 'zod';
import { NextResponse } from 'next/server';
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
    const result = await selection.provider.generate(
      {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(parsed.data.currentSource, parsed.data.prompt),
        model: selection.model,
      },
      ac.signal,
    );

    if (result.kind === 'error') {
      const httpStatus = result.status >= 400 && result.status < 500 ? 'unavailable' : 'error';
      return NextResponse.json<ModelGenerationResult>(
        { status: httpStatus, message: result.message },
        { status: 502 },
      );
    }

    const source = extractCode(result.text);
    if (!source) {
      return NextResponse.json<ModelGenerationResult>(
        { status: 'error', message: 'Provider returned an empty response.' },
        { status: 502 },
      );
    }

    return NextResponse.json<ModelGenerationResult>({
      status: 'success',
      source,
      message: `Updated by ${selection.provider.name}:${selection.model}.`,
    });
  } finally {
    clearTimeout(timer);
  }
}
