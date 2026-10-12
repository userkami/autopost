import { z } from 'zod';
import { isNearDuplicate } from './dedupe';

/**
 * Write step output schema + quality gates (PLAN.md §11.2).
 * The writer must return exactly this JSON; on parse failure the caller
 * retries once with a repair instruction, then marks the post failed.
 */

export const writeOutputSchema = z.object({
  title: z.string().min(1),
  meta_description: z.string().max(160),
  html: z.string().min(1),
  labels: z.array(z.string()).default([]),
  image_prompt: z.string().default(''),
  image_alt: z.string().default(''),
});

export type WriteOutput = z.infer<typeof writeOutputSchema>;

/** Strip HTML tags to count words / detect headings in the article body. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

export function countWords(html: string): number {
  return stripTags(html)
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function countH2(html: string): number {
  return (html.match(/<h2[\s>]/gi) ?? []).length;
}

const PLACEHOLDERS = ['[insert', 'lorem', 'todo'];

export type QualityGateInput = {
  output: WriteOutput;
  minWords: number;
  maxWords: number;
  /** Case-insensitive blocklist from app_settings.blocklist_keywords. */
  blocklist?: readonly string[];
  /** Existing titles to reject near-duplicates against. */
  existingTitles?: readonly string[];
};

export type QualityResult = { ok: boolean; failures: string[] };

/** Run every §11.2 quality gate; returns human-readable failure reasons. */
export function checkWriteQuality(input: QualityGateInput): QualityResult {
  const { output, minWords, maxWords } = input;
  const failures: string[] = [];

  // Word count within [min, max] ±15%.
  const words = countWords(output.html);
  const low = Math.floor(minWords * 0.85);
  const high = Math.ceil(maxWords * 1.15);
  if (words < low || words > high) {
    failures.push(`Word count ${words} outside allowed range ${low}–${high}`);
  }

  if (countH2(output.html) < 3) {
    failures.push('Article must contain at least 3 <h2> headings');
  }

  const haystack = `${output.title}\n${output.html}`.toLowerCase();
  for (const placeholder of PLACEHOLDERS) {
    if (haystack.includes(placeholder)) {
      failures.push(`Contains placeholder text "${placeholder}"`);
    }
  }

  for (const keyword of input.blocklist ?? []) {
    const needle = keyword.trim().toLowerCase();
    if (needle && haystack.includes(needle)) {
      failures.push(`Contains blocklisted keyword "${keyword}"`);
    }
  }

  if (input.existingTitles?.length && isNearDuplicate(output.title, input.existingTitles)) {
    failures.push('Title is a near-duplicate of an existing post');
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Try to parse the writer's JSON. Tolerates fenced ```json blocks and leading
 * prose by extracting the first balanced object. Returns null on failure so the
 * caller can retry once with a repair instruction.
 */
export function parseWriteOutput(text: string): WriteOutput | null {
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      const parsed = writeOutputSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // try next candidate
    }
  }
  return null;
}
