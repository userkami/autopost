import Link from 'next/link';
import { db } from '@/db';
import { requireUser } from '@/lib/guards';
import { loadBlogSettings, roleAllowedForProvider } from '@/lib/blog-settings';
import { DEFAULT_BLOG_PROFILE } from '@/lib/blog-profile';
import {
  clearRoleAction,
  deleteBlogAction,
  saveRoleAction,
  setImageHostAction,
  updateBlogProfileAction,
  updatePublishSettingsAction,
  useSameConnectionForAllAction,
} from './actions';
import type { AIRole } from '@/lib/readiness';

/**
 * Blog settings (PLAN.md §13 /blogs/[id]/settings): sections are Blog profile ·
 * AI roles (3 cards + "Use same connection for all") · Publish mode · Image
 * host · Danger zone. Server Component + server actions only (§14 pattern);
 * role assignment is re-validated server-side by `upsertBlogRole` (§7).
 */

const ROLE_META: Array<{ role: AIRole; label: string; kind: 'text' | 'image'; hint: string }> = [
  { role: 'research', label: 'Research', kind: 'text', hint: 'Finds angles and facts before writing.' },
  { role: 'writing', label: 'Writing', kind: 'text', hint: 'Drafts the post from the topic and research.' },
  { role: 'image', label: 'Image', kind: 'image', hint: 'Generates the cover/inline images.' },
];

export default async function BlogSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await loadBlogSettings(db, user.id, id);

  const blog = data?.blog;
  if (!data || !blog) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">Blog not found or access denied.</p>
        <Link href="/dashboard" className="text-sm underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const profile = { ...DEFAULT_BLOG_PROFILE, ...(blog.profile ?? {}) };
  const roleBy = new Map(data.roles.map((r) => [r.role, r]));
  const connById = new Map(data.aiConnections.map((c) => [c.id, c]));
  const selectedHost = data.imageHosts.find((h) => h.id === blog.imageHostId) ?? null;
  const googleOk = data.googleConnection?.status === 'active';

  return (
    <div className="space-y-10">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Blog settings</h1>
          <p className="text-sm text-neutral-500">
            {blog.name} ·{' '}
            <Link href={`/blogs/${blog.id}`} className="underline">
              overview
            </Link>
          </p>
        </div>
      </div>

      {sp.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{sp.status}</div>
      ) : null}
      {sp.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{sp.error}</div>
      ) : null}

      {!googleOk ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Google connection is {data.googleConnection?.status ?? 'missing'} —{' '}
          <Link href="/connect" className="underline">
            reconnect
          </Link>{' '}
          before posts can be published.
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Blog profile                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Blog profile</h2>
          <p className="text-sm text-neutral-500">Used by research and writing to keep posts on-brand.</p>
        </div>
        <form action={updateBlogProfileAction.bind(null, blog.id)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Niche
            <input
              name="niche"
              defaultValue={profile.niche}
              placeholder="e.g. personal finance for freelancers"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Audience
            <input
              name="audience"
              defaultValue={profile.audience}
              placeholder="e.g. US-based independent contractors"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Tone
            <input
              name="tone"
              defaultValue={profile.tone}
              placeholder="e.g. friendly, practical, no jargon"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Language
            <input
              name="language"
              defaultValue={profile.language}
              placeholder="en"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Min words
            <input
              name="min_words"
              type="number"
              min={100}
              max={10_000}
              defaultValue={profile.min_words}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Max words
            <input
              name="max_words"
              type="number"
              min={200}
              max={20_000}
              defaultValue={profile.max_words}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Keywords (comma-separated)
            <input
              name="keywords"
              defaultValue={profile.keywords.join(', ')}
              placeholder="budgeting, taxes, invoicing"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Default labels (comma-separated)
            <input
              name="default_labels"
              defaultValue={profile.default_labels.join(', ')}
              placeholder="guide, news"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Research mode
            <select name="research_mode" defaultValue={profile.research_mode} className="mt-1 w-full rounded border px-3 py-2 text-sm">
              <option value="manual">Manual (paste your own)</option>
              <option value="brainstorm">Brainstorm (AI suggests)</option>
              <option value="grounded">Grounded (AI + web search)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm pb-2">
            <input name="ai_disclosure" type="checkbox" defaultChecked={profile.ai_disclosure} className="h-4 w-4" />
            Disclose AI assistance in posts
          </label>
          <label className="text-sm sm:col-span-2">
            Prompt override — research
            <textarea
              name="prompt_research"
              defaultValue={profile.prompt_overrides.research ?? ''}
              rows={2}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Prompt override — writer
            <textarea
              name="prompt_writer"
              defaultValue={profile.prompt_overrides.writer ?? ''}
              rows={2}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Prompt override — image
            <textarea
              name="prompt_image"
              defaultValue={profile.prompt_overrides.image ?? ''}
              rows={2}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save profile</button>
          </div>
        </form>
      </section>


      {/* AI roles */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">AI roles</h2>
          <p className="text-sm text-neutral-500">
            Each role picks one connection and a model. Connections are tested on the{' '}
            <Link href="/connections" className="underline">
              Connections
            </Link>{' '}
            page.
          </p>
        </div>

        {data.aiConnections.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No AI connections yet.{' '}
            <Link href="/connections" className="underline">
              Add one
            </Link>{' '}
            to assign roles.
          </p>
        ) : (
          <>
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Use same connection for all three roles</summary>
              <form action={useSameConnectionForAllAction.bind(null, blog.id)} className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  Connection
                  <select name="aiConnectionId" className="mt-1 w-full rounded border px-3 py-2 text-sm">
                    {data.aiConnections.map((conn) => (
                      <option key={conn.id} value={conn.id}>
                        {conn.label} ({conn.provider})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Model
                  <input
                    name="model"
                    required
                    placeholder="model id, e.g. gemini-2.5-flash"
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex items-end">
                  <button className="rounded-md border px-4 py-2 text-sm hover:bg-neutral-100">Apply to all supported roles</button>
                </div>
              </form>
              <p className="mt-2 text-xs text-neutral-500">
                Roles the provider cannot serve (e.g. image on a text-only provider) are left unchanged.
              </p>
            </details>


            <div className="grid gap-4 lg:grid-cols-3">
              {ROLE_META.map(({ role, label, kind, hint }) => {
                const current = roleBy.get(role);
                const currentConn =
                  current?.aiConnectionId != null ? (connById.get(current.aiConnectionId) ?? null) : null;
                const options = data.aiConnections.filter((c) => roleAllowedForProvider(c.provider, role));
                return (
                  <div key={role} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{label}</h3>
                      {current ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            currentConn ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {currentConn ? 'configured' : 'orphaned'}
                        </span>
                      ) : (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">not set</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">{hint}</p>

                    {options.length === 0 ? (
                      <p className="mt-3 text-xs text-neutral-500">
                        No {kind}-capable connections.{' '}
                        <Link href="/connections" className="underline">
                          Add one
                        </Link>
                        .
                      </p>
                    ) : (
                      <form action={saveRoleAction.bind(null, blog.id)} className="mt-3 space-y-2">
                        <input type="hidden" name="role" value={role} />
                        <label className="block text-xs">
                          Connection
                          <select
                            name="aiConnectionId"
                            defaultValue={current?.aiConnectionId ?? ''}
                            required
                            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                          >
                            <option value="" disabled>
                              Select…
                            </option>
                            {options.map((conn) => (
                              <option key={conn.id} value={conn.id}>
                                {conn.label} ({conn.provider})
                                {conn.lastTestStatus ? ` · ${conn.lastTestStatus}` : ' · untested'}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs">
                          Model
                          <input
                            name="model"
                            required
                            defaultValue={current?.model ?? ''}
                            placeholder="model id"
                            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700">Save</button>
                          {current ? (
                            <button
                              formAction={clearRoleAction.bind(null, blog.id)}
                              className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>


      {/* Publish mode */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Publish mode</h2>
          <p className="text-sm text-neutral-500">Controls what happens when a post finishes generating.</p>
        </div>
        <form action={updatePublishSettingsAction.bind(null, blog.id)} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Mode
            <select name="publishMode" defaultValue={blog.publishMode} className="mt-1 w-full rounded border px-3 py-2 text-sm">
              <option value="review">Review — wait for your approval</option>
              <option value="auto">Auto — publish without review</option>
              <option value="draft">Draft — always save as Blogger draft</option>
            </select>
          </label>
          <label className="text-sm">
            Review expires after (hours)
            <input
              name="reviewExpiryHours"
              type="number"
              min={1}
              max={720}
              defaultValue={blog.reviewExpiryHours}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 self-end text-sm pb-2">
            <input name="autoPublishOnExpiry" type="checkbox" defaultChecked={blog.autoPublishOnExpiry} className="h-4 w-4" />
            Auto-publish when review expires
          </label>
          <div className="sm:col-span-3">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save publish settings</button>
          </div>
        </form>
      </section>

      {/* Image host */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Image host</h2>
          <p className="text-sm text-neutral-500">
            Where generated images are uploaded before being attached to the post. Manage hosts on the{' '}
            <Link href="/connections" className="underline">
              Connections
            </Link>{' '}
            page.
          </p>
        </div>
        {data.imageHosts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No image hosts yet.{' '}
            <Link href="/connections" className="underline">
              Add one
            </Link>
            .
          </p>
        ) : (
          <form action={setImageHostAction.bind(null, blog.id)} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Host
              <select name="imageHostId" defaultValue={blog.imageHostId ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="">— none —</option>
                {data.imageHosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.label} ({host.provider})
                    {host.lastTestStatus ? ` · ${host.lastTestStatus}` : ' · untested'}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Save</button>
            {selectedHost ? <span className="pb-2 text-xs text-neutral-500">Currently: {selectedHost.label}</span> : null}
          </form>
        )}
      </section>

      {/* Danger zone */}
      <section className="space-y-4 rounded-lg border border-red-300 p-4">
        <div>
          <h2 className="text-lg font-semibold text-red-700">Danger zone</h2>
          <p className="text-sm text-neutral-500">
            Removing a blog deletes its roles, schedule, topics, runs, and post history. This cannot be undone.
          </p>
        </div>
        <form action={deleteBlogAction.bind(null, blog.id)} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Type <strong>delete</strong> to confirm
            <input name="confirm" required pattern="delete" className="mt-1 w-48 rounded border px-3 py-2 text-sm" />
          </label>
          <button className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">Remove blog</button>
        </form>
      </section>
    </div>
  );
}

