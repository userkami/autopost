/**
 * Research prompt template (PLAN.md §11.1).
 * Returns 10 candidate topics as a JSON array of strings.
 */
export const RESEARCH_PROMPT = `You are a research assistant for a blog.
Blog niche: {{niche}}
Audience: {{audience}}
Keywords: {{keywords}}
Recent titles (avoid duplicates):
{{recentTitles}}

Propose exactly 10 specific, original article topic ideas an expert in this niche would write.
Each topic must be concrete (not a category), useful to the audience, and not generic.
Return ONLY a JSON array of 10 strings, each a topic title.`;