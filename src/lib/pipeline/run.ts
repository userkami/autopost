import { db } from '../../db';
import { runs, runSteps, posts, blogs, users } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  runResearchStep,
  runWriteStep,
  runImageStep,
  runUploadStep,
  runAssembleStep,
  runDeliverStep,
} from './steps';
import { PipelineContext, StepName, StepResult } from './types';
import { BlogProfile } from '../blog-profile';
import { PostContent } from './types';
import { notify, recordEmailLog, createReviewPending, createPostPublished } from '../notify';

export interface ExecuteRunOptions {
  interPostDelayMs?: number;
  maxWriteAttempts?: number;
}

export async function executeRun(runId: string, _options: ExecuteRunOptions = {}) {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error('Run not found');

  const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, run.blogId) });
  if (!blog) throw new Error('Blog not found');

  let post = await db.query.posts.findFirst({ where: eq(posts.runId, runId) });
  if (!post) {
    [post] = await db.insert(posts).values({
      blogId: blog.id,
      runId: runId,
      title: 'Generating...',
      html: '<p>Generating...</p>',
      status: 'generating',
    }).returning();
  }

  const ctx: PipelineContext = {
    runId: run.id,
    postId: post.id,
    blogId: blog.id,
    userId: blog.userId,
    profile: blog.profile as BlogProfile,
  };

  const steps: StepName[] = ['research', 'write', 'image', 'upload', 'assemble', 'deliver'];
  let currentTopic: string | null = null;
  let currentContent: unknown = null;
  let currentImageBytes: Buffer | null = null;
  let currentImageUrl: string | null = null;
  let currentAssembled: unknown = null;

  for (const stepName of steps) {
    const existingStep = await db.query.runSteps.findFirst({
      where: and(eq(runSteps.runId, runId), eq(runSteps.step, stepName), eq(runSteps.status, 'succeeded')),
    });

    if (existingStep) {
      const output = existingStep.output as Record<string, unknown> | null;
      if (stepName === 'research') currentTopic = (output?.topic as string) ?? null;
      if (stepName === 'write') currentContent = output;
      if (stepName === 'image') currentImageBytes = (output?.bytes as Buffer) ?? null;
      if (stepName === 'upload') currentImageUrl = (output?.url as string) ?? null;
      if (stepName === 'assemble') currentAssembled = output;
      continue;
    }

    await db.insert(runSteps).values({
      runId: run.id,
      step: stepName,
      status: 'running',
      startedAt: new Date(),
    }).onConflictDoUpdate({
      target: [runSteps.runId, runSteps.step],
      set: { status: 'running', startedAt: new Date() },
    });

    let result: StepResult;

    switch (stepName) {
      case 'research':
        result = await runResearchStep(ctx);
        if (result.status === 'succeeded') currentTopic = (result.output as { topic: string } | undefined)?.topic ?? null;
        break;
      case 'write':
        if (!currentTopic) throw new Error('No topic available for writing');
        result = await runWriteStep(ctx, currentTopic);
        if (result.status === 'succeeded') currentContent = result.output;
        break;
      case 'image':
        if (!currentContent) throw new Error('No content available for image generation');
        result = await runImageStep(ctx, currentContent as PostContent);
        if (result.status === 'succeeded') currentImageBytes = (result.output as { bytes: Buffer } | undefined)?.bytes ?? null;
        break;
      case 'upload':
        result = await runUploadStep(ctx, currentImageBytes);
        if (result.status === 'succeeded') currentImageUrl = (result.output as { url: string } | undefined)?.url ?? null;
        break;
      case 'assemble':
        if (!currentContent) throw new Error('No content available for assembly');
        result = await runAssembleStep(ctx, currentContent as PostContent, currentImageUrl);
        if (result.status === 'succeeded') currentAssembled = result.output;
        break;
      case 'deliver':
        if (!currentAssembled) throw new Error('No assembled content to deliver');
        const finalPost = { ...(currentContent as Record<string, unknown>), ...(currentAssembled as Record<string, unknown>) };
        result = await runDeliverStep(ctx, finalPost as PostContent);
        break;
      default:
        throw new Error('Unknown step');
    }

    await db.update(runSteps)
      .set({
        status: result.status,
        output: result.output,
        error: result.error,
        finishedAt: new Date(),
      })
      .where(and(eq(runSteps.runId, run.id), eq(runSteps.step, stepName)));

    if (result.status === 'failed') {
      await db.update(runs).set({ status: 'failed', finishedAt: new Date(), error: result.error }).where(eq(runs.id, runId));
      await db.update(posts).set({ status: 'failed' }).where(eq(posts.id, post.id));
      throw new Error('Step failed: ' + result.error);
    }
  }

  const finalPostData = {
    ...(currentContent as Record<string, unknown>),
    ...(currentAssembled as Record<string, unknown>),
    image_url: currentImageUrl,
  } as { title: string; html: string; image_url: string | null; labels: string[]; meta_description: string; bloggerPostId?: string; bloggerUrl?: string };

  // Refresh post to get bloggerPostId and bloggerUrl from deliver step
  const [updatedPost] = await db
    .select()
    .from(posts)
    .where(eq(posts.id, post.id))
    .limit(1);

  const finalStatus = blog.publishMode === 'review' ? 'pending_review' : 'published';
  await db.update(posts).set({
    ...finalPostData,
    status: finalStatus,
  }).where(eq(posts.id, post.id));

  // Send notifications
  if (blog.publishMode === 'review') {
    const notification = createReviewPending({
      blogId: blog.id,
      blogName: blog.name,
      postId: post.id,
      postTitle: (finalPostData.title as string) ?? updatedPost?.title ?? 'Untitled',
      reviewUrl: `/blogs/${blog.id}/posts?filter=pending_review`,
      expiryHours: blog.reviewExpiryHours,
    });
    notification.userId = blog.userId;
    const result = await notify(db, notification);

    // Log email attempt
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, blog.userId))
      .limit(1);
    if (user?.email) {
      await recordEmailLog(db, {
        userId: blog.userId,
        notificationType: 'review_pending',
        recipient: user.email,
        subject: notification.emailSubject!,
        sent: result.emailSent,
        error: result.emailSent ? undefined : 'SMTP not configured or send failed',
      });
    }
  } else {
    // Auto or draft mode - notify post published
    const [postWithBlogger] = await db
      .select({ bloggerPostId: posts.bloggerPostId, bloggerUrl: posts.bloggerUrl })
      .from(posts)
      .where(eq(posts.id, post.id))
      .limit(1);

    const bloggerUrl = postWithBlogger?.bloggerUrl ?? `https://www.blogger.com/blogger.g?blogID=${blog.bloggerBlogId}#editor/target=post;postID=${postWithBlogger?.bloggerPostId ?? post.id}`;
    const notification = createPostPublished({
      blogId: blog.id,
      blogName: blog.name,
      postId: post.id,
      postTitle: (finalPostData.title as string) ?? updatedPost?.title ?? 'Untitled',
      bloggerUrl,
    });
    notification.userId = blog.userId;
    const result = await notify(db, notification);

    // Log email attempt
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, blog.userId))
      .limit(1);
    if (user?.email) {
      await recordEmailLog(db, {
        userId: blog.userId,
        notificationType: 'post_published',
        recipient: user.email,
        subject: notification.emailSubject!,
        sent: result.emailSent,
        error: result.emailSent ? undefined : 'SMTP not configured or send failed',
      });
    }
  }

  await db.update(runs).set({ status: 'succeeded', finishedAt: new Date() }).where(eq(runs.id, runId));
}