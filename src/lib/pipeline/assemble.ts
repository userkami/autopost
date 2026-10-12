import sanitizeHtml from 'sanitize-html';

/**
 * Assemble step: sanitize the writer's HTML to a strict allowlist, wrap the
 * image in a <figure>, optionally append an AI-disclosure line, and merge
 * labels (PLAN.md §11.5). Using sanitize-html (PLAN §2) rather than a hand-
 * rolled regex — an HTML allowlist is security-critical.
 */

/** PLAN §11.5 allowlist. */
const ALLOWED_TAGS = [
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'figure', 'figcaption', 'br',
];

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Force safe link rel/target regardless of what the model emitted.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    // Drop scripts/styles/iframes and their event handlers entirely.
    disallowedTagsMode: 'discard',
  });
}

/** Escape text for safe interpolation into HTML attributes/content. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type AssembleInput = {
  html: string;
  imageUrl?: string | null;
  imageAlt?: string;
  /** Caption shown under the cover figure. Defaults to the image alt. */
  imageCaption?: string;
  /** When true, append the AI-disclosure line (blog profile.ai_disclosure). */
  aiDisclosure?: boolean;
};

const AI_DISCLOSURE_LINE =
  '<p><em>This post was drafted with AI assistance and reviewed before publishing.</em></p>';

/**
 * Full assemble step: sanitize, prepend the cover <figure>, optionally append
 * the disclosure line. Returns the final HTML stored on the post and sent to
 * Blogger.
 */
export function assembleArticle(input: AssembleInput): string {
  const body = sanitizeArticleHtml(input.html);

  let figure = '';
  if (input.imageUrl) {
    const src = escapeHtml(input.imageUrl);
    const alt = escapeHtml(input.imageAlt ?? '');
    const captionText = input.imageCaption ?? input.imageAlt ?? '';
    const caption = captionText
      ? `<figcaption>${escapeHtml(captionText)}</figcaption>`
      : '';
    figure = `<figure><img src="${src}" alt="${alt}" style="max-width:100%">${caption}</figure>`;
  }

  const disclosure = input.aiDisclosure ? AI_DISCLOSURE_LINE : '';
  return `${figure}${body}${disclosure}`;
}

/** Merge labels: dedupe case-insensitively, cap at 20, each <= 50 chars (§11.5). */
export function mergeLabels(...groups: Array<readonly string[] | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const label = raw.trim().slice(0, 50);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= 20) return out;
    }
  }
  return out;
}
