import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateModel } from '@/model/llm';

const originalFetch = globalThis.fetch;

const mockFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  globalThis.fetch = vi.fn(impl as typeof fetch);
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('generateModel (client)', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns success when the route returns success', async () => {
    mockFetch(async () =>
      jsonResponse(200, {
        status: 'success',
        source: 'api.cabinet({});',
        message: 'ok',
      }),
    );

    const out = await generateModel({ prompt: 'add one', currentSource: '' });
    expect(out.status).toBe('success');
    if (out.status === 'success') {
      expect(out.source).toBe('api.cabinet({});');
    }
  });

  it('returns unavailable when the route returns 503/unavailable', async () => {
    mockFetch(async () =>
      jsonResponse(503, {
        status: 'unavailable',
        message: 'Missing LLM_API_KEY.',
      }),
    );

    const out = await generateModel({ prompt: 'x', currentSource: '' });
    expect(out.status).toBe('unavailable');
    expect(out.message).toContain('LLM_API_KEY');
  });

  it('returns error when the route returns error', async () => {
    mockFetch(async () =>
      jsonResponse(502, {
        status: 'error',
        message: 'Provider returned 429',
      }),
    );

    const out = await generateModel({ prompt: 'x', currentSource: '' });
    expect(out.status).toBe('error');
  });

  it('returns error on network failure', async () => {
    mockFetch(async () => {
      throw new Error('socket hangup');
    });

    const out = await generateModel({ prompt: 'x', currentSource: '' });
    expect(out.status).toBe('error');
    expect(out.message).toContain('socket hangup');
  });

  it('returns error when the route response is not parseable JSON', async () => {
    mockFetch(async () =>
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    const out = await generateModel({ prompt: 'x', currentSource: '' });
    expect(out.status).toBe('error');
    expect(out.message).toContain('Bad response');
  });
});
