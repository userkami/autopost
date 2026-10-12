import { describe, expect, it } from 'vitest';
import { checkWriteQuality, countWords, parseWriteOutput } from '@/lib/pipeline/write';

function body(h2Count: number, words: number): string {
  const headings = Array.from({ length: h2Count }, (_, i) => `<h2>Section ${i + 1}</h2>`).join('');
  const filler = Array.from({ length: words }, () => 'word').join(' ');
  return `${headings}<p>${filler}</p>`;
}

const baseOutput = {
  title: 'How to file quarterly taxes as a freelancer',
  meta_description: 'A practical guide.',
  html: body(3, 100),
  labels: ['taxes'],
  image_prompt: 'an office desk',
  image_alt: 'a desk with paperwork',
};

describe('pipeline write output (PLAN.md §11.2)', () => {
  it('countWords ignores HTML tags', () => {
    expect(countWords('<p>one two three</p>')).toBe(3);
  });

  it('parseWriteOutput accepts a clean JSON object', () => {
    const parsed = parseWriteOutput(JSON.stringify(baseOutput));
    expect(parsed?.title).toBe(baseOutput.title);
  });

  it('parseWriteOutput unwraps a fenced ```json block', () => {
    const parsed = parseWriteOutput('Here you go:\n```json\n' + JSON.stringify(baseOutput) + '\n```');
    expect(parsed?.title).toBe(baseOutput.title);
  });

  it('parseWriteOutput extracts an object surrounded by prose', () => {
    const parsed = parseWriteOutput('Sure! ' + JSON.stringify(baseOutput) + ' Done.');
    expect(parsed?.title).toBe(baseOutput.title);
  });

  it('parseWriteOutput returns null for garbage', () => {
    expect(parseWriteOutput('not json at all')).toBeNull();
  });

  it('passes all gates for a good article', () => {
    const result = checkWriteQuality({ output: baseOutput, minWords: 100, maxWords: 100 });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails when the word count is too low', () => {
    const result = checkWriteQuality({ output: { ...baseOutput, html: body(3, 10) }, minWords: 100, maxWords: 200 });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes('Word count'))).toBe(true);
  });

  it('fails with fewer than 3 h2 headings', () => {
    const result = checkWriteQuality({ output: { ...baseOutput, html: body(2, 100) }, minWords: 100, maxWords: 100 });
    expect(result.failures.some((f) => f.includes('<h2>'))).toBe(true);
  });

  it('fails on placeholder text', () => {
    const result = checkWriteQuality({
      output: { ...baseOutput, html: body(3, 100) + '<p>[insert conclusion here]</p>' },
      minWords: 100,
      maxWords: 100,
    });
    expect(result.failures.some((f) => f.includes('placeholder'))).toBe(true);
  });

  it('fails on a blocklisted keyword', () => {
    const result = checkWriteQuality({
      output: { ...baseOutput, html: body(3, 100) + '<p>buy cheap crypto now</p>' },
      minWords: 100,
      maxWords: 100,
      blocklist: ['crypto'],
    });
    expect(result.failures.some((f) => f.includes('blocklisted'))).toBe(true);
  });

  it('fails on a near-duplicate title', () => {
    const result = checkWriteQuality({
      output: baseOutput,
      minWords: 100,
      maxWords: 100,
      existingTitles: ['how to file quarterly taxes as a freelancer'],
    });
    expect(result.failures.some((f) => f.includes('near-duplicate'))).toBe(true);
  });

  it('allows the ±15% word-count tolerance', () => {
    // min 100 → low bound floor(85) = 85; 90 words should pass.
    const result = checkWriteQuality({ output: { ...baseOutput, html: body(3, 90) }, minWords: 100, maxWords: 200 });
    expect(result.ok).toBe(true);
  });
});
