/**
 * Title dedupe (PLAN.md §11.1): normalize (lowercase, strip punctuation and
 * stopwords) and reject titles whose trigram-Jaccard similarity against an
 * existing title is >= 0.6. Pure so the research step, quality gate and tests
 * all share one definition.
 */

/** Common English stopwords stripped before comparison. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'your', 'you',
]);

/** Lowercase, drop punctuation, collapse whitespace, strip stopwords. */
export function normalizeTitle(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  return words.join(' ');
}

/** Set of character trigrams from a normalized string (pads with spaces). */
export function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const out = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Jaccard similarity of two trigram sets: |A∩B| / |A∪B|. 0 when both empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Similarity of two titles (0..1) after normalization. */
export function titleSimilarity(a: string, b: string): number {
  return jaccard(trigrams(normalizeTitle(a)), trigrams(normalizeTitle(b)));
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/** True when `candidate` is a near-duplicate of any existing title. */
export function isNearDuplicate(
  candidate: string,
  existingTitles: readonly string[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): boolean {
  return existingTitles.some((title) => titleSimilarity(candidate, title) >= threshold);
}

/** Filter a candidate list down to non-duplicates of `existingTitles`. */
export function rejectDuplicates<T extends { title: string }>(
  candidates: readonly T[],
  existingTitles: readonly string[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): T[] {
  const accepted: T[] = [];
  const seen = [...existingTitles];
  for (const item of candidates) {
    if (isNearDuplicate(item.title, seen, threshold)) continue;
    accepted.push(item);
    seen.push(item.title);
  }
  return accepted;
}
