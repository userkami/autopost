import { desc } from 'drizzle-orm';
import { providerCatalog } from '@/db/schema';
import { db } from '@/db';
import { requireAdmin } from '@/lib/guards';
import { adminCatalogAction } from './actions';

export default async function AdminCatalogPage() {
  await requireAdmin();

  const rows = await db.select().from(providerCatalog).orderBy(desc(providerCatalog.createdAt));

  const roleOptions = ['text', 'image'] as const;
  const providers = ['gemini', 'openai', 'openrouter', 'anthropic', 'pollinations', 'fal', 'leonardo', 'custom_openai', 'mock'] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Provider catalog</h1>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Add model</h2>
        <form action={adminCatalogAction} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="action" value="create" />
          <label className="text-sm">
            Provider
            <select name="provider" required className="mt-1 w-full rounded border px-3 py-2 text-sm">
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Role
            <select name="role" required className="mt-1 w-full rounded border px-3 py-2 text-sm">
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Model ID
            <input name="modelId" required placeholder="e.g., gpt-4o" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            Label
            <input name="label" required placeholder="e.g., GPT-4o" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
          <div className="sm:col-span-4 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isDefault" />
              Default
            </label>
            <label className="text-sm">
              Notes
              <input name="notes" placeholder="Optional notes" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </label>
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Add to catalog</button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Catalog ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No models in catalog.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Provider</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Model ID</th>
                  <th className="text-left px-4 py-3 font-medium">Label</th>
                  <th className="text-left px-4 py-3 font-medium">Default</th>
                  <th className="text-left px-4 py-3 font-medium">Deprecated</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                  <th className="text-left px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((item) => (
                  <tr key={item.id} className={item.deprecatedAt ? 'bg-neutral-50' : 'hover:bg-neutral-50'}>
                    <td className="px-4 py-3 font-medium capitalize">{item.provider}</td>
                    <td className="px-4 py-3">{item.role}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.modelId}</td>
                    <td className="px-4 py-3">{item.label}</td>
                    <td className="px-4 py-3">{item.isDefault ? <span className="rounded bg-green-100 text-green-800 text-xs px-1.5 py-0.5">Yes</span> : '—'}</td>
                    <td className="px-4 py-3">{item.deprecatedAt ? new Date(item.deprecatedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500 max-w-xs truncate">{item.notes ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {!item.deprecatedAt && (
                          <form action={adminCatalogAction} onSubmit={(e) => { if (!confirm('Deprecate this model?')) e.preventDefault(); }}>
                            <input type="hidden" name="action" value="deprecate" />
                            <input type="hidden" name="id" value={item.id} />
                            <button className="text-amber-600 hover:underline text-sm">Deprecate</button>
                          </form>
                        )}
                        <form action={adminCatalogAction} onSubmit={(e) => { if (!confirm('Delete this catalog entry?')) e.preventDefault(); }}>
                          <input type="hidden" name="action" value="delete" />
                          <input type="hidden" name="id" value={item.id} />
                          <button className="text-red-600 hover:underline text-sm">Delete</button>
                        </form>
                        <button className="text-blue-600 hover:underline text-sm">Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}