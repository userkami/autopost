import { z } from 'zod';
import { BlogProfile } from '../blog-profile';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'canceled';
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type StepName = 'research' | 'write' | 'image' | 'upload' | 'assemble' | 'deliver';

export const PostContentSchema = z.object({
  title: z.string().min(5),
  meta_description: z.string().max(160),
  html: z.string(),
  labels: z.array(z.string()),
  image_prompt: z.string(),
  image_alt: z.string(),
});

export type PostContent = z.infer<typeof PostContentSchema>;

export interface PipelineContext {
  runId: string;
  postId: string;
  blogId: string;
  userId: string;
  profile: BlogProfile;
}

export interface StepResult {
  status: StepStatus;
  output?: unknown;
  error?: string;
}
