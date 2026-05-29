import { describe, it, expect } from 'vitest';
import { preflight, referencesSelection } from '@/model/llm/preflight';

describe('referencesSelection', () => {
  it.each([
    'remove the selected door',
    'make selected 50mm taller',
    'edit the selection',
    'extend the selection until the back panel',
    'resize this panel',
    'remove that cabinet',
    'tilt this one',
  ])('detects selection language: %s', (prompt) => {
    expect(referencesSelection(prompt)).toBe(true);
  });

  it.each([
    'make the cabinet 1000mm wide',
    'add a drawer to the first cabinet',
    'set count to 5',
    'create another cabinet at x=2000',
    // 'it' on its own is too ambiguous — we deliberately don't match it.
    'leave it as is',
  ])('does not match neutral language: %s', (prompt) => {
    expect(referencesSelection(prompt)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(referencesSelection('Resize SELECTED part')).toBe(true);
  });
});

describe('preflight', () => {
  it('returns unavailable when the prompt references selection but selectionId is null', () => {
    const out = preflight('remove the selected door', null);
    expect(out).not.toBeNull();
    expect(out?.kind).toBe('unavailable');
    expect(out?.message).toMatch(/selected/i);
  });

  it('returns null when the prompt references selection AND selectionId is set', () => {
    expect(preflight('remove the selected door', 'door#1-0')).toBeNull();
  });

  it('returns null when the prompt does not reference selection (no id needed)', () => {
    expect(preflight('add a drawer', null)).toBeNull();
  });

  it('returns null when both are present (irrelevant case)', () => {
    expect(preflight('add a drawer', 'door#1-0')).toBeNull();
  });
});
