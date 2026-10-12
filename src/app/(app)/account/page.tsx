import Link from 'next/link';
import { requireUser } from '@/lib/guards';
import { signOutAction } from '../actions';
import { deleteAccountAction } from './actions';

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Account</h1>

      <dl className="divide-y rounded-lg border">
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-neutral-500">Email</dt>
          <dd className="font-medium">{user.email}</dd>
        </div>
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-neutral-500">Name</dt>
          <dd className="font-medium">{user.name ?? '—'}</dd>
        </div>
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-neutral-500">Role</dt>
          <dd className="font-medium">{user.isAdmin ? 'Admin' : 'User'}</dd>
        </div>
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-neutral-500">Blog limit</dt>
          <dd className="font-medium">{user.blogLimit ?? 'default'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-3">
        <form action={signOutAction}>
          <button type="submit" className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-100">
            Sign out
          </button>
        </form>

        <Link
          href="/api/account/export"
          className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-100"
        >
          Export my data
        </Link>

        <button
          type="button"
          onClick={() => document.getElementById('delete-modal')?.classList.remove('hidden')}
          className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          Delete account
        </button>
      </div>

      {/* Delete confirmation modal */}
      <div id="delete-modal" className="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
          <h2 className="text-xl font-bold text-red-600 mb-4">Delete account?</h2>
          <p className="text-sm text-neutral-600 mb-4">
            This action is irreversible. All your blogs, connections, posts, runs, and data will be permanently deleted.
            Google refresh tokens will be revoked.
          </p>
          <form action={deleteAccountAction} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type your email to confirm</label>
              <input
                name="confirmEmail"
                type="email"
                required
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type DELETE to confirm</label>
              <input
                name="confirmDeletion"
                type="text"
                required
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="DELETE"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => document.getElementById('delete-modal')?.classList.add('hidden')}
                className="rounded border px-3 py-2 text-sm hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button type="submit" className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">
                Delete my account
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}