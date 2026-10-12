import { describe, expect, it } from 'vitest';
import { assembleArticle, escapeHtml, mergeLabels, sanitizeArticleHtml } from '@/lib/pipeline/assemble';
import { renderTemplate, resolvePrompt, WRITER_PROMPT } from '@/lib/pipeline/prompts';

describe('pipeline assemble (PLAN.md §11.5)', () => {
  it('strips scripts, styles, iframes and event handlers', () => {
    const dirty =
      '<p>ok</p><script>alert(1)</script><style>.x{}</style><iframe src="evil"></iframe><p onclick="x()">click</p>';
    const clean = sanitizeArticleHtml(dirty);
    expect(clean).not.toMatch(/script|style|iframe|onclick/i);
    expect(clean).toContain('<p');
  });

  it('keeps the allowed article tags', () => {
    const html = '<h2>t</h2><p>a</p><ul><li>x</li></ul><strong>b</strong><table><tr><td>c</td></tr></table>';
    const clean = sanitizeArticleHtml(html);
    for (const tag of ['<h2', '<p', '<ul', '<li', '<strong', '<table', '<td']) {
      expect(clean).toContain(tag);
    }
  });

  it('forces rel/target on links and drops javascript: hrefs', () => {
    const clean = sanitizeArticleHtml('<a href="https://x.test" rel="">go</a><a href="javascript:alert(1)">bad</a>');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).not.toContain('javascript:');
  });

  it('escapes HTML in attribute values', () => {
    expect(escapeHtml('<a "b">')).toBe('&lt;a &quot;b&quot;&gt;');
  });

  it('prepends a figure with escaped src/alt', () => {
    const html = assembleArticle({
      html: '<p>body</p>',
      imageUrl: 'https://i.test/a.png',
      imageAlt: 'a "nice" image',
    });
    expect(html.startsWith('<figure>')).toBe(true);
    expect(html).toContain('src="https://i.test/a.png"');
    expect(html).toContain('&quot;nice&quot;');
    expect(html).toContain('<p>body</p>');
  });

  it('appends the AI-disclosure line only when enabled', () => {
    expect(assembleArticle({ html: '<p>b</p>', aiDisclosure: true })).toContain('AI assistance');
    expect(assembleArticle({ html: '<p>b</p>' })).not.toContain('AI assistance');
  });

  it('mergeLabels dedupes case-insensitively, caps length and count', () => {
    expect(mergeLabels(['Taxes', 'taxes', '  guide '], ['GUIDE'])).toEqual(['Taxes', 'guide']);
    expect(mergeLabels(['x'.repeat(80)])[0]).toHaveLength(50);
    expect(mergeLabels(Array.from({ length: 30 }, (_, i) => `l${i}`))).toHaveLength(20);
  });
});

describe('pipeline prompts (PLAN.md §11)', () => {
  it('replaces {{variables}} including arrays', () => {
    expect(renderTemplate('a {{x}} b {{y}}', { x: 1, y: ['p', 'q'] })).toBe('a 1 b p, q');
  });

  it('leaves unknown placeholders untouched for visibility', () => {
    expect(renderTemplate('{{missing}}', {})).toBe('{{missing}}');
  });

  it('resolvePrompt prefers a non-empty override', () => {
    expect(resolvePrompt('  custom  ', WRITER_PROMPT)).toBe('custom');
    expect(resolvePrompt('', WRITER_PROMPT)).toBe(WRITER_PROMPT);
    expect(resolvePrompt(undefined, WRITER_PROMPT)).toBe(WRITER_PROMPT);
  });

  it('the writer prompt demands the exact JSON schema', () => {
    for (const key of ['title', 'meta_description', 'html', 'labels', 'image_prompt', 'image_alt']) {
      expect(WRITER_PROMPT).toContain(`"${key}"`);
    }
  });
});
