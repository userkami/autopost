import { requireUser } from '@/lib/guards';
import { listAiConnections, listImageHosts, toPublicAiConnection, toPublicImageHost } from '@/lib/connections';
import { db } from '@/db';
import { PROVIDER_METADATA, capabilitiesFor } from '@/lib/providers/registry';
import { IMAGE_HOST_METADATA } from '@/lib/imagehosts/registry';
import {
  createAiConnectionAction,
  createImageHostAction,
  deleteAiConnectionAction,
  deleteImageHostAction,
  testAiConnectionAction,
  testImageHostAction,
} from './actions';

/**
 * Connections (PLAN.md §13 /connections): AI connections and image hosts with
 * add/delete and Test buttons. Saved secrets are never displayed (§14.2).
 */
export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const user = await requireUser();
  const [params, aiRows, hostRows] = await Promise.all([
    searchParams,
    listAiConnections(db, user.id),
    listImageHosts(db, user.id),
  ]);
  const ai = aiRows.map(toPublicAiConnection);
  const hosts = hostRows.map(toPublicImageHost);

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Connections</h1>
        <p className="text-sm text-neutral-500">
          You bring your own AI keys — the platform never pays for AI usage.
        </p>
      </div>

      {params.status ? (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {params.status}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {params.error}
        </div>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">AI connections</h2>

        {ai.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No AI connections yet. Add one below.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {ai.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{connection.label}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                      {connection.provider}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {describeCapabilities(connection.provider)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Key: ••••{connection.hasKey ? '' : ' (missing)'}
                    {connection.baseUrl ? ` · ${connection.baseUrl}` : ''}
                    {connection.lastTestStatus
                      ? ` · last test: ${connection.lastTestStatus}${connection.lastTestError ? ` (${connection.lastTestError})` : ''}`
                      : ' · not tested'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={testAiConnectionAction}>
                    <input type="hidden" name="id" value={connection.id} />
                    <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-100">
                      Test
                    </button>
                  </form>
                  <form action={deleteAiConnectionAction}>
                    <input type="hidden" name="id" value={connection.id} />
                    <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg border p-4" open={ai.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">Add AI connection</summary>
          <form action={createAiConnectionAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Provider
              <select name="provider" className="mt-1 w-full rounded border px-3 py-2 text-sm" defaultValue="gemini">
                {PROVIDER_METADATA.map((provider) => (
                  <option key={provider.provider} value={provider.provider}>
                    {provider.label}
                    {provider.provider === 'mock' ? ' — dev only' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Label
              <input
                name="label"
                required
                placeholder="My Gemini key"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              API key
              <input
                name="apiKey"
                type="password"
                required
                autoComplete="off"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Base URL (custom providers only)
              <input
                name="baseUrl"
                placeholder="https://my-endpoint.example.com/v1"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <div className="sm:col-span-2">
              <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                Add connection
              </button>
            </div>
          </form>
        </details>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Image hosts</h2>

        {hosts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-neutral-500">
            No image hosts yet. Blogger has no image-upload API, so a host is required to publish
            images.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {hosts.map((host) => (
              <li key={host.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{host.label}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                      {host.provider}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Config: ••••{host.hasConfig ? '' : ' (missing)'}
                    {host.lastTestStatus ? ` · last test: ${host.lastTestStatus}` : ' · not tested'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={testImageHostAction}>
                    <input type="hidden" name="id" value={host.id} />
                    <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-100">
                      Test
                    </button>
                  </form>
                  <form action={deleteImageHostAction}>
                    <input type="hidden" name="id" value={host.id} />
                    <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg border p-4" open={hosts.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">Add image host</summary>
          <form action={createImageHostAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Provider
              <select name="provider" className="mt-1 w-full rounded border px-3 py-2 text-sm" defaultValue="imgbb">
                {IMAGE_HOST_METADATA.map((host) => (
                  <option key={host.provider} value={host.provider}>
                    {host.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Label
              <input
                name="label"
                required
                placeholder="My imgbb"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              API key (imgbb) / API key (Cloudinary, signed)
              <input name="apiKey" type="password" autoComplete="off" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <p className="text-xs text-neutral-500 sm:col-span-2">
              Cloudinary: provide a cloud name plus either an unsigned upload preset, or an API key
              + secret. imgbb: just the API key.
            </p>
            <input name="cloudName" placeholder="Cloudinary cloud name" className="rounded border px-3 py-2 text-sm" />
            <input name="uploadPreset" placeholder="Cloudinary upload preset (unsigned)" className="rounded border px-3 py-2 text-sm" />
            <input name="apiSecret" type="password" autoComplete="off" placeholder="Cloudinary API secret (signed)" className="rounded border px-3 py-2 text-sm sm:col-span-2" />
            <div className="sm:col-span-2">
              <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                Add image host
              </button>
            </div>
          </form>
        </details>
      </section>
    </div>
  );
}

function describeCapabilities(provider: (typeof PROVIDER_METADATA)[number]['provider']): string {
  const caps = capabilitiesFor(provider);
  const parts: string[] = [];
  if (caps.text) parts.push('text');
  if (caps.image) parts.push('image');
  if (caps.groundedSearch) parts.push('grounded search');
  return parts.join(' · ');
}