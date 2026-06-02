/**
 * Real-LLM end-to-end tests. Hit the configured provider (Groq, Ollama, …)
 * directly to verify the system prompt + tools actually drive the model into
 * calling tools and producing valid source.
 *
 * Skipped by default. Enable with:
 *
 *   LLM_E2E=1 npm test                                       (uses .env.local)
 *   LLM_E2E=1 LLM_API_KEY=gsk_... LLM_BASE_URL=... npm test  (override)
 *
 * Tests assert *properties* of the output (parses, has expected ids, fewer
 * doors than before), not exact strings — LLMs are non-deterministic even at
 * temperature 0, and tiny phrasing differences are acceptable.
 *
 * Each test allocates ~30s; full run usually completes in ~10–20s on Groq.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateText } from 'ai';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/model/llm/prompt';
import { extractCode } from '@/model/llm/extract';
import { buildSceneTools } from '@/model/llm/tools';
import { SceneQuery } from '@/model/scene/query';
import { runModel } from '@/model/runtime';
import { selectProvider, type ProviderSelection } from '@/model/llm/providers';
import type { SceneNode } from '@/domain/cabinet/types';

// Load .env.local if present so the test can pick up the same vars the dev
// server uses. Next.js auto-loads these in normal app code; vitest doesn't.
async function maybeLoadEnvLocal() {
  if (process.env.LLM_API_KEY) return;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(file)) return;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // best-effort; if anything fails, the tests will simply skip.
  }
}

const TEST_SOURCE = `const cab = api.cabinet({
  width: param('width', 800),
  height: param('height', 1800),
  depth: param('depth', 400),
  thickness: 18,
  position: [0, 0, 0],
});
api.shelf({ in: cab, y: 600 });
api.shelf({ in: cab, y: 1200 });
api.door({ in: cab, side: 'left' });
api.door({ in: cab, side: 'right' });
`;

const TIMEOUT_MS = 30_000;

// `LLM_E2E` opt-in lets the rest of the suite stay fast and offline by default.
const e2eEnabled = process.env.LLM_E2E === '1';

describe.skipIf(!e2eEnabled)('llm e2e — real provider', () => {
  let selection: ProviderSelection;

  beforeAll(async () => {
    await maybeLoadEnvLocal();
    selection = selectProvider();
  });

  afterAll(() => {
    // no-op; provider has no resources to clean up
  });

  async function ask(
    prompt: string,
    source = TEST_SOURCE,
    selectionId: string | null = null,
  ): Promise<{ source: string; toolNames: string[] }> {
    const runResult = runModel(source);
    const query = new SceneQuery(runResult);
    const tools = buildSceneTools(query, selectionId);

    const { text, steps } = await generateText({
      model: selection.model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(source, prompt),
      tools,
      maxSteps: 6,
      temperature: 0,
    });

    const toolNames = steps.flatMap((s) =>
      (s.toolCalls ?? []).map((c: { toolName: string }) => c.toolName),
    );
    return { source: extractCode(text), toolNames };
  }

  it(
    'produces source that parses and runs',
    async () => {
      const { source } = await ask('Make the cabinet width 1000mm.');
      const out = runModel(source);
      expect(out.error).toBeUndefined();
      // Width should be 1000 either as a literal or via param default.
      expect(source).toMatch(/1000/);
    },
    TIMEOUT_MS,
  );

  it(
    'calls getSelection when the user references "selected"',
    async () => {
      const initial = runModel(TEST_SOURCE);
      const door = findFirstByType(initial.nodes, 'door');
      expect(door, 'precondition: source should produce a door node').toBeTruthy();

      const { source, toolNames } = await ask('Remove the selected door.', TEST_SOURCE, door!.id);

      expect(toolNames, 'expected the model to call getSelection').toContain('getSelection');

      // The output must still parse.
      const out = runModel(source);
      expect(out.error).toBeUndefined();

      // And the door count should have decreased (or the doors field is now <2).
      const beforeDoors = countNodes(initial.nodes, 'door');
      const afterDoors = countNodes(out.nodes, 'door');
      expect(afterDoors).toBeLessThan(beforeDoors);
    },
    TIMEOUT_MS,
  );

  // (The "no selection but prompt says 'selected'" case is now handled
  //  deterministically by the route's preflight guard — see
  //  tests/llm.preflight.test.ts. No LLM round-trip required.)
});

function findFirstByType(nodes: readonly SceneNode[], type: SceneNode['type']): SceneNode | null {
  for (const n of nodes) {
    if (n.type === type) return n;
    const child = findFirstByType(n.children, type);
    if (child) return child;
  }
  return null;
}

function countNodes(nodes: readonly SceneNode[], type: SceneNode['type']): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === type) count++;
    count += countNodes(n.children, type);
  }
  return count;
}
