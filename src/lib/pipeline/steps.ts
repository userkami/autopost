import { StepResult, PipelineContext, PostContent } from './types';
import { RESEARCH_PROMPT } from './prompts/research';
import { WRITER_PROMPT } from './prompts/writer';
import { REPAIR_PROMPT } from './prompts';
import { getTextProvider, getImageProvider } from '../providers/registry';
import { getImageHost } from '../imagehosts/registry';
import { db } from '../../db';
import { topics, posts, blogs, blogRoles, aiConnections, imageHosts } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import sanitizeHtml from 'sanitize-html';
import { BloggerClient } from '../blogger/client';
import { getValidAccessToken } from '../blogger/service';
import { blogConnections } from '../../db/schema';
import { renderTemplate, resolvePrompt } from './prompts';
import { rejectDuplicates } from './dedupe';
import { BlogProfile } from '../blog-profile';
import { parseWriteOutput, checkWriteQuality } from './write';
import { ProviderError } from '../providers/errors';
import type { ProviderConnection } from '../providers/registry';
import { decrypt } from '../crypto';

async function getProviderConnectionForRole(
  blogId: string,
  role: 'research' | 'writing' | 'image'
): Promise<ProviderConnection | null> {
  const roleRow = await db.query.blogRoles.findFirst({
    where: and(eq(blogRoles.blogId, blogId), eq(blogRoles.role, role)),
  });
  if (!roleRow?.aiConnectionId) return null;

  const conn = await db.query.aiConnections.findFirst({
    where: eq(aiConnections.id, roleRow.aiConnectionId),
  });
  if (!conn) return null;

  return {
    provider: conn.provider,
    apiKey: conn.apiKeyEnc ? decrypt(conn.apiKeyEnc) : '',
    baseUrl: conn.baseUrl,
    extra: conn.extraEnc ? (JSON.parse(decrypt(conn.extraEnc)) as Record<string, unknown>) : null,
  };
}

async function getImageHostConnectionForBlog(blogId: string) {
  const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, blogId) });
  if (!blog?.imageHostId) return null;

  const host = await db.query.imageHosts.findFirst({
    where: eq(imageHosts.id, blog.imageHostId),
  });
  if (!host) return null;

  const config = host.configEnc ? JSON.parse(decrypt(host.configEnc)) : {};
  return { provider: host.provider, config };
}

export async function runResearchStep(ctx: PipelineContext): Promise<StepResult> {
  try {
    const queuedTopic = await db.query.topics.findFirst({
      where: and(eq(topics.blogId, ctx.blogId), eq(topics.status, 'queued')),
      orderBy: (t, { asc }) => [asc(t.id)],
    });

    if (queuedTopic) {
      await db.update(topics).set({ status: 'used', usedAt: new Date() }).where(eq(topics.id, queuedTopic.id));
      return { status: 'succeeded', output: { topic: queuedTopic.title } };
    }

    const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, ctx.blogId) });
    if (!blog) throw new Error('Blog not found');

    const profile = blog.profile as BlogProfile;

    const recentPosts = await db.query.posts.findMany({
      where: eq(posts.blogId, ctx.blogId),
      limit: 50,
      orderBy: (p, { desc }) => [desc(p.publishedAt)],
    });

    const existingTitles = recentPosts.map((p) => p.title);

    const providerConn = await getProviderConnectionForRole(ctx.blogId, 'research');
    if (!providerConn) throw new Error('No research provider configured for this blog');
    const provider = getTextProvider(providerConn);

    const role = await db.query.blogRoles.findFirst({
      where: and(eq(blogRoles.blogId, ctx.blogId), eq(blogRoles.role, 'research')),
    });

    const researchPrompt = resolvePrompt(
      profile.prompt_overrides?.research,
      RESEARCH_PROMPT
    );

    const grounded = profile.research_mode === 'grounded';

    const result = await provider.generate({
      model: role?.model || 'default',
      prompt: renderTemplate(researchPrompt, {
        niche: profile.niche,
        audience: profile.audience,
        keywords: profile.keywords.join(', '),
        recentTitles: existingTitles.join('\n'),
      }),
      json: true,
      grounded,
    });

    const data = JSON.parse(result.text);
    const candidates = Array.isArray(data) ? data : [data.topic];

    const filtered = rejectDuplicates(
      candidates.map((title: string) => ({ title })),
      existingTitles
    );

    const selected = filtered[0];
    if (!selected) {
      throw new Error('All generated topics were duplicates of existing posts');
    }

    await db.insert(topics).values({
      blogId: ctx.blogId,
      title: selected.title,
      source: profile.research_mode,
      status: 'used',
      usedAt: new Date(),
    });

    return { status: 'succeeded', output: { topic: selected.title } };
  } catch (e: unknown) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function runWriteStep(ctx: PipelineContext, topic: string): Promise<StepResult> {
  try {
    const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, ctx.blogId) });
    if (!blog) throw new Error('Blog not found');

    const profile = blog.profile as BlogProfile;

    const providerConn = await getProviderConnectionForRole(ctx.blogId, 'writing');
    if (!providerConn) throw new Error('No writing provider configured for this blog');
    const provider = getTextProvider(providerConn);

    const role = await db.query.blogRoles.findFirst({
      where: and(eq(blogRoles.blogId, ctx.blogId), eq(blogRoles.role, 'writing')),
    });

    const writerPrompt = resolvePrompt(
      profile.prompt_overrides?.writer,
      WRITER_PROMPT
    );

    const recentPosts = await db.query.posts.findMany({
      where: eq(posts.blogId, ctx.blogId),
      limit: 50,
      orderBy: (p, { desc }) => [desc(p.publishedAt)],
    });

    const existingTitles = recentPosts.map((p) => p.title);

    // Try up to 2 times: initial + one repair attempt
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await provider.generate({
        model: role?.model || 'default',
        prompt: attempt === 0
          ? renderTemplate(writerPrompt, {
              topic,
              niche: profile.niche,
              audience: profile.audience,
              tone: profile.tone,
              language: profile.language,
              min_words: profile.min_words,
              max_words: profile.max_words,
              research: '',
            })
          : REPAIR_PROMPT,
        json: true,
      });

      const parsed = parseWriteOutput(result.text);
      if (!parsed) continue;

      const quality = checkWriteQuality({
        output: parsed,
        minWords: profile.min_words,
        maxWords: profile.max_words,
        blocklist: [],
        existingTitles,
      });

      if (quality.ok) {
        return { status: 'succeeded', output: parsed };
      }
      // If quality fails, loop will retry with repair prompt
    }

    throw new Error('Content failed quality gates after repair attempt');
  } catch (e: unknown) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function runImageStep(ctx: PipelineContext, content: PostContent): Promise<StepResult> {
  try {
    const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, ctx.blogId) });
    if (!blog) throw new Error('Blog not found');

    const profile = blog.profile as BlogProfile;

    const providerConn = await getProviderConnectionForRole(ctx.blogId, 'image');
    if (!providerConn) throw new Error('No image provider configured for this blog');
    const provider = getImageProvider(providerConn);

    const role = await db.query.blogRoles.findFirst({
      where: and(eq(blogRoles.blogId, ctx.blogId), eq(blogRoles.role, 'image')),
    });

    // Try up to 2 times: initial + one retry with simplified prompt on content_policy
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0
        ? content.image_prompt
        : `Simple editorial illustration for: ${content.title}. Clean, minimal, no text.`;

      try {
        const result = await provider.generate({
          model: role?.model || 'default',
          prompt,
          aspect: '16:9',
        });

        return { status: 'succeeded', output: { bytes: result.bytes, mime: result.mime } };
      } catch (e: unknown) {
        if (e instanceof ProviderError && e.kind === 'content_policy' && attempt === 0) {
          // Retry with simplified prompt
          continue;
        }
        throw e;
      }
    }

    // If we get here, both attempts failed (or error wasn't content_policy)
    if (profile.allow_no_image !== false) {
      return { status: 'skipped', output: null };
    }
    throw new Error('Image generation failed after content policy retry');
  } catch (e: unknown) {
    const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, ctx.blogId) });
    if (blog?.profile?.allow_no_image !== false) {
      return { status: 'skipped', output: null };
    }
    return { status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function runUploadStep(ctx: PipelineContext, imageBytes: Buffer | null): Promise<StepResult> {
  try {
    if (!imageBytes) return { status: 'skipped', output: null };

    const hostConn = await getImageHostConnectionForBlog(ctx.blogId);
    if (!hostConn) throw new Error('No image host configured for this blog');

    const host = getImageHost(hostConn);
    const result = await host.upload({ bytes: imageBytes, mime: 'image/png', filename: 'cover.png' });

    return { status: 'succeeded', output: { url: result.url } };
  } catch (e: unknown) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function runAssembleStep(ctx: PipelineContext, content: PostContent, imageUrl: string | null): Promise<StepResult> {
  try {
    const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, ctx.blogId) });
    if (!blog) throw new Error('Blog not found');

    // 1. Sanitize HTML
    const cleanHtml = sanitizeHtml(content.html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'target', 'rel'],
        img: ['src', 'alt', 'style'],
      },
      transformTags: {
        a: (tagName: string, attribs: Record<string, string>) => {
          return {
            tagName,
            attribs: { ...attribs, rel: 'noopener noreferrer' },
          };
        },
      },
    });

    // 2. Prepend image figure
    let finalHtml = cleanHtml;
    if (imageUrl) {
      finalHtml = `<figure><img src="${imageUrl}" alt="${content.image_alt}" style="max-width:100%"><figcaption></figcaption></figure>\n` + finalHtml;
    }

    // 3. Append AI disclosure
    if (blog.profile?.ai_disclosure) {
      finalHtml += '\n<p><em>This post was generated with the assistance of AI.</em></p>';
    }

    // 4. Merge labels
    const mergedLabels = Array.from(new Set([
      ...content.labels,
      ...(blog.profile?.default_labels || []),
    ])).slice(0, 20).map((l) => l.slice(0, 50));

    return {
      status: 'succeeded',
      output: {
        html: finalHtml,
        labels: mergedLabels,
      },
    };
  } catch (e: unknown) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function runDeliverStep(ctx: PipelineContext, post: PostContent): Promise<StepResult> {
  try {
    const blog = await db.query.blogs.findFirst({ where: eq(blogs.id, ctx.blogId) });
    if (!blog) throw new Error('Blog not found');

    if (blog.publishMode === 'review') {
      return { status: 'succeeded', output: { status: 'pending_review' } };
    }

    const connection = await db.query.blogConnections.findFirst({
      where: eq(blogConnections.id, blog.connectionId),
    });
    if (!connection) throw new Error('Blog connection not found');

    const accessToken = await getValidAccessToken(db, connection);
    const client = new BloggerClient(accessToken, blog.bloggerBlogId);
    const isDraft = blog.publishMode === 'draft';

    const result = await client.createPost(
      {
        title: post.title,
        content: post.html,
        labels: post.labels,
      },
      { isDraft }
    );

    return { status: 'succeeded', output: { bloggerPostId: result.id, bloggerUrl: `https://www.blogger.com/blogger.g?blogID=${blog.bloggerBlogId}#editor/target=post;postID=${result.id}` } };
  } catch (e: unknown) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}