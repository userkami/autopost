/**
 * Writer prompt template (PLAN.md §11.2).
 * Returns the exact JSON schema required by writeOutputSchema.
 */
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