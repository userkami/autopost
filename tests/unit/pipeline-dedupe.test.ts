import { describe, expect, it } from 'vitest';
import {
  isNearDuplicate,
  jaccard,
  normalizeTitle,
  rejectDuplicates,
  titleSimilarity,
  trigrams,
} from '@/lib/pipeline/dedupe';

describe('pipeline dedupe (PLAN.md §11.1 — trigram-Jaccard)', () => {
  it('normalizes by lowercasing, stripping punctuation and stopwords', () => {
    expect(normalizeTitle('The Best Budgeting Apps of 2026!')).toBe('best budgeting apps 2026');
  });

  it('computes identical trigrams for identical strings', () => {
    expect(jaccard(trigrams('budgeting'), trigrams('budgeting'))).toBe(1);
  });

  it('scores identical titles as 1.0', () => {
    expect(titleSimilarity('How to file taxes', 'How to file taxes')).toBe(1);
  });

  it('scores unrelated titles near 0', () => {
    expect(titleSimilarity('How to file taxes', 'Best camera lenses')).toBeLessThan(0.1);
  });

  it('treats punctuation/case differences as duplicates', () => {
    expect(isNearDuplicate('Best Budgeting Apps', ['best budgeting apps!'])).toBe(true);
  });

  it('flags a reworded near-duplicate above the 0.6 threshold', () => {
    expect(
      isNearDuplicate('Best budgeting apps for 2026', ['Best budgeting apps of 2026']),
    ).toBe(true);
  });

  it('does not flag genuinely different titles', () => {
    expect(
      isNearDuplicate('Best budgeting apps for freelancers', ['How to file quarterly taxes']),
    ).toBe(false);
  });

  it('rejectDuplicates keeps only the first of a duplicate pair', () => {
    const result = rejectDuplicates(
      [
        { title: 'How to file taxes' },
        { title: 'how to file taxes!!' },
        { title: 'A totally different topic' },
      ],
      [],
    );
    expect(result.map((r) => r.title)).toEqual(['How to file taxes', 'A totally different topic']);
  });

  it('rejectDuplicates honours existing titles as already-taken', () => {
    const result = rejectDuplicates([{ title: 'Intro to investing' }], ['intro investing guide']);
    expect(result).toHaveLength(0);
  });
});
