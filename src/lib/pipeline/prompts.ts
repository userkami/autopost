/**
 * Pipeline prompts (PLAN.md §11): template strings with {{variables}}. A
 * blog's `profile.prompt_overrides.{research,writer,image}` fully replaces the
 * default template for that step when present.
 */

export type PromptVariables = Record<string, string | number | string[]>;

/** Replace {{key}} placeholders. Unknown keys are left as-is for visibility. */
export function renderTemplate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) return match;
    return Array.isArray(value) ? value.join(', ') : String(value);
  });
}

/** Merge a per-blog override over a default template (override wins entirely). */
export function resolvePrompt(override: string | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : fallback;
}

// ---------------------------------------------------------------------------
// Default templates
// ---------------------------------------------------------------------------

export const RESEARCH_PROMPT = `You are a research assistant for a blog.
Blog niche: {{niche}}
Audience: {{audience}}
Keywords: {{keywords}}

Propose exactly 10 specific, original article topic ideas an expert in this niche would write.
Each topic must be concrete (not a category), useful to the audience, and not generic.
Return ONLY a JSON array of 10 strings, each a topic title.`;

export const WRITER_PROMPT = `Write a blog post as an experienced practitioner. Be original, specific and experience-led.
Use concrete examples. Do NOT invent statistics, quotes or studies — express honest uncertainty instead.
No filler intros; get straight to the value.

Blog niche: {{niche}}
Audience: {{audience}}
Tone: {{tone}}
Language: {{language}}
Target length: {{min_words}}–{{max_words}} words.

Article topic: {{topic}}
Research notes (may be empty): {{research}}

Return ONLY a single JSON object with EXACTLY these keys:
{
  "title": "compelling, specific title",
  "meta_description": "<=160 chars summarising the post",
  "html": "<article body: no <h1>, use <h2>/<h3> for sections, plus <p>, <ul>/<ol>, <a>, <strong>, <em>, <table> where useful>",
  "labels": ["3-6 short labels"],
  "image_prompt": "a vivid prompt for a cover image",
  "image_alt": "accessible alt text describing the cover image"
}
The html must contain at least three <h2> sections and no placeholder text.`;

export const IMAGE_PROMPT = `Blog niche style: {{niche}}.
Create a clean, editorial cover image for a blog post titled "{{topic}}".
Image prompt from the writer: {{image_prompt}}
No text or words in the image.`;

export const REPAIR_PROMPT = `Your previous reply was not valid JSON matching the required schema.
Reply again with ONLY the single JSON object, no markdown fences, no prose.
Required keys: title, meta_description, html, labels, image_prompt, image_alt.`;
