import { describe, it, expect } from 'vitest';
import { extractCode } from '@/model/llm/extract';

describe('extractCode', () => {
  it('returns the input unchanged when there are no fences', () => {
    const src = `api.cabinet({ width: 800 });`;
    expect(extractCode(src)).toBe(src);
  });

  it('strips a ```js fenced block', () => {
    const raw = '```js\napi.cabinet({ width: 800 });\n```';
    expect(extractCode(raw)).toBe(`api.cabinet({ width: 800 });`);
  });

  it('strips a ```javascript fenced block', () => {
    const raw = '```javascript\napi.cabinet({ width: 800 });\n```';
    expect(extractCode(raw)).toBe(`api.cabinet({ width: 800 });`);
  });

  it('strips a bare ``` fenced block', () => {
    const raw = '```\napi.cabinet({ width: 800 });\n```';
    expect(extractCode(raw)).toBe(`api.cabinet({ width: 800 });`);
  });

  it('pulls the first fence out of a response with leading prose', () => {
    const raw =
      'Sure! Here is the updated model:\n\n```js\napi.cabinet({ width: 800 });\n```\n\nHope that helps!';
    expect(extractCode(raw)).toBe(`api.cabinet({ width: 800 });`);
  });

  it('trims surrounding whitespace', () => {
    expect(extractCode('   \n\napi.cabinet({});\n\n  ')).toBe('api.cabinet({});');
  });
});
