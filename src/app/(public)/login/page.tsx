import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, googleConfigured } from '@/auth';
import { devLoginEnabled } from '@/lib/dev-login';
import { settings } from '@/lib/settings';
import { devSignInAction, googleSignInAction } from './actions';

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    'Sign-in was refused — your account may be suspended, signups may be closed, or an invite is required.',
  Configuration: 'Authentication is misconfigured. Contact the site operator.',
  OAuthSignin: 'Could not start Google sign-in. Please try again.',
  OAuthCallback: 'Google sign-in did not complete. Please try again.',
  OAuthAccountNotLinked: 'This Google account is already linked to a different sign-in method.',
  default: 'Sign-in failed. Please try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  const [params, signupsMode] = await Promise.all([searchParams, settings.get('signups_mode')]);
  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.default!)
    : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Sign in to AutoBlog</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {signupsMode === 'closed'
            ? 'Signups are currently closed.'
            : signupsMode === 'invite_only'
              ? 'This instance is invite-only — you need an invite to join.'
              : 'Sign in with your Google account.'}
        </p>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </div>
      ) : null}

      {googleConfigured ? (
        <form action={googleSignInAction}>
          <button
            type="submit"
            className="w-full rounded-md border px-4 py-2.5 font-medium hover:bg-neutral-50"
          >
            Continue with Google
          </button>
        </form>
      ) : (
        <div className="rounded-md border border-dashed px-4 py-3 text-center text-xs text-neutral-500">
          Google sign-in is not configured yet — add AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (see
          HUMAN_TASKS.md).
        </div>
      )}

      {devLoginEnabled ? (
        <form action={devSignInAction} className="space-y-3 rounded-md border p-4">
          <p className="text-xs text-neutral-500">
            Dev login (mock providers enabled — never available in production).
          </p>
          <input
            name="email"
            type="email"
            required
            defaultValue="dev@example.com"
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Email"
          />
          <input
            name="password"
            type="password"
            required
            defaultValue="dev"
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Password"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Dev sign in
          </button>
        </form>
      ) : null}

      <p className="text-center text-xs text-neutral-500">
        By continuing you agree to the{' '}
        <Link href="/terms" className="underline">
          terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </main>
  );
}
