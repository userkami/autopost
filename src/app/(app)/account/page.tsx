import { requireUser } from '@/lib/guards';
import { signOutAction } from '../actions';

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

      <div className="flex gap-3">
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-100"
          >
            Sign out
          </button>
        </form>
        {/* Data export / account deletion arrive in Phase 8 (PLAN.md §14.11). */}
      </div>
    </div>
  );
}
