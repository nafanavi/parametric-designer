import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/model/llm/prompt';

describe('SYSTEM_PROMPT', () => {
  it('describes every DomainAPI entry point', () => {
    for (const name of ['api.cabinet', 'api.panel', 'api.shelf', 'api.door', 'api.drawer']) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it('declares the mm unit convention', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('millimetre');
  });

  it('explains param() semantics', () => {
    expect(SYSTEM_PROMPT).toContain("param(name, defaultValue)");
  });

  it('forbids markdown fences in the response', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('no markdown');
  });
});

describe('buildUserPrompt', () => {
  it('wraps the current source between marker comments', () => {
    const out = buildUserPrompt('api.cabinet({});', 'add another');
    expect(out).toContain('/* --- CURRENT MODEL --- */');
    expect(out).toContain('/* --- END CURRENT MODEL --- */');
    expect(out).toContain('api.cabinet({});');
  });

  it('includes the user request verbatim', () => {
    const out = buildUserPrompt('// source', 'add a 600mm cabinet');
    expect(out).toContain('add a 600mm cabinet');
  });

  it('trims surrounding whitespace from both inputs', () => {
    const out = buildUserPrompt('   api.cabinet({});   \n', '   add another   ');
    expect(out).toContain('api.cabinet({});\n/* --- END CURRENT MODEL --- */');
    expect(out).toContain('User request:\nadd another\n');
  });
});
