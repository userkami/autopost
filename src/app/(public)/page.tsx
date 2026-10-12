import Link from 'next/link';
import { env } from '@/lib/env';

export default function HomePage() {
  const appName = env.APP_NAME;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="space-y-4">
        <h1 className="text-5xl font-bold tracking-tight">{appName}</h1>
        <p className="text-xl text-neutral-600 max-w-2xl mx-auto">
          AI-powered blog automation. Research, write, generate images, and publish to your Blogger blogs —
          automatically or with human review.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-3 text-left">
        <article className="rounded-lg border p-6 hover:bg-neutral-50">
          <h3 className="text-lg font-semibold mb-2">Research & Write</h3>
          <p className="text-sm text-neutral-600">
            AI researches topics from your niche, writes SEO-optimized articles with quality gates
            (word count, headings, no placeholders), and deduplicates against your history.
          </p>
        </article>
        <article className="rounded-lg border p-6 hover:bg-neutral-50">
          <h3 className="text-lg font-semibold mb-2">Images & Publishing</h3>
          <p className="text-sm text-neutral-600">
            Generates featured images via your AI provider, uploads to imgbb/Cloudinary, assembles
            HTML with sanitization, and publishes to Blogger — draft, review, or auto.
          </p>
        </article>
        <article className="rounded-lg border p-6 hover:bg-neutral-50">
          <h3 className="text-lg font-semibold mb-2">Your Keys, Your Control</h3>
          <p className="text-sm text-neutral-600">
            Bring your own AI keys (OpenAI, Anthropic, Google, etc.) and image host credentials.
            Encrypted at rest (AES-256-GCM). Free tier: 2 blogs. Admin can raise limits.
          </p>
        </article>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/login"
          className="rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Sign in with Google
        </Link>
        <Link href="/privacy" className="text-sm underline underline-offset-2">
          Privacy Policy
        </Link>
        <Link href="/terms" className="text-sm underline underline-offset-2">
          Terms of Service
        </Link>
      </div>

      <p className="text-xs text-neutral-400">
        By signing in, you agree to our <Link href="/terms" className="underline">Terms</Link> and{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </main>
  );
}