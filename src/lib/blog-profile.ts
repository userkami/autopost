import { z } from 'zod';

/**
 * `blogs.profile` jsonb shape (PLAN.md §5).
 * Snake_case keys exactly as specified in the plan.
 */
export const blogProfileSchema = z.object({
  niche: z.string().default(''),
  audience: z.string().default(''),
  tone: z.string().default(''),
  language: z.string().default('en'),
  min_words: z.number().int().min(100).max(10_000).default(800),
  max_words: z.number().int().min(200).max(20_000).default(1600),
  keywords: z.array(z.string()).default([]),
  default_labels: z.array(z.string()).default([]),
  ai_disclosure: z.boolean().default(false),
  research_mode: z.enum(['manual', 'brainstorm', 'grounded']).default('brainstorm'),
  /** When true, an image-step failure continues without an image (PLAN §11.3). */
  allow_no_image: z.boolean().default(true),
  prompt_overrides: z
    .object({
      research: z.string().optional(),
      writer: z.string().optional(),
      image: z.string().optional(),
    })
    .default({}),
});

export type BlogProfile = z.infer<typeof blogProfileSchema>;

export const DEFAULT_BLOG_PROFILE: BlogProfile = blogProfileSchema.parse({});
