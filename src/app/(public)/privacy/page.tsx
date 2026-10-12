import Link from 'next/link';
import { env } from '@/lib/env';

export default function PrivacyPage() {
  const appName = env.APP_NAME;

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="text-sm text-neutral-500">Last updated: {new Date().toLocaleDateString()}</p>

      <section>
        <h2 className="text-xl font-semibold">1. Data we collect</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li><strong>Account data:</strong> Email, name, profile picture (from Google OAuth), admin flag, blog limit, max posts per day.</li>
          <li><strong>Blogger connection:</strong> Google account email, Google subject ID, encrypted refresh token, granted scopes.</li>
          <li><strong>Blog data:</strong> Blogger blog ID, blog name, blog URL, publish mode, review settings, image host selection.</li>
          <li><strong>AI connections:</strong> Provider name, label, encrypted API key, optional base URL and extra config.</li>
          <li><strong>Image hosts:</strong> Provider name, label, encrypted configuration (API keys, cloud names, etc.).</li>
          <li><strong>Content:</strong> Generated posts (titles, HTML, images, labels), run history, step outputs, usage metrics.</li>
          <li><strong>Audit log:</strong> Admin actions, user actions, timestamps, IP addresses.</li>
          <li><strong>Technical:</strong> IP address, user agent, request timestamps (for security and rate limiting).</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. How we use your data</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li>Authenticate you via Google OAuth (identity scopes only: openid, email, profile).</li>
          <li>Connect to Blogger API on your behalf using a separate OAuth flow with the <code>https://www.googleapis.com/auth/blogger</code> scope.</li>
          <li>Store and encrypt your API keys and refresh tokens (AES-256-GCM).</li>
          <li>Generate blog posts using your configured AI providers and publish to your Blogger blogs.</li>
          <li>Send notifications (in-app and optional email) about review items, published posts, failures, and reconnect needs.</li>
          <li>Enforce blog limits, rate limits, and security policies.</li>
          <li>Maintain audit trails for security and compliance.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Blogger data usage</h2>
        <p className="text-sm text-neutral-700 mt-2">
          {appName}&apos;s use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements.
        </p>
        <p className="text-sm text-neutral-700 mt-2">
          Blogger data (blog list, post creation, publishing) is used <strong>only</strong> to publish your own posts to your own Blogger blogs. We do not read, analyze, or share your Blogger content with third parties.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Storage and encryption</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li>All secrets (Google refresh tokens, AI API keys, image host credentials) are encrypted at rest using AES-256-GCM with a per-value random IV.</li>
          <li>Encryption format: <code>{`v1:<keyId>:<iv>:<tag>:<ciphertext>`}</code> (base64).</li>
          <li>The master key (<code>MASTER_KEY</code>) is sourced from the environment only — never stored in the database or code.</li>
          <li>Database: PostgreSQL with Drizzle ORM. All timestamps are UTC.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Data sharing</h2>
        <p className="text-sm text-neutral-700 mt-2">We do not sell or share your personal data with third parties, except:</p>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li>To Google APIs (Blogger, OAuth) when you initiate actions that require them.</li>
          <li>To your configured AI providers (OpenAI, Anthropic, Google, etc.) when generating content.</li>
          <li>To your configured image host (imgbb, Cloudinary) when uploading images.</li>
          <li>When required by law or to protect our rights.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Data retention and deletion</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li>Account data is retained while your account is active.</li>
          <li>You can delete your account at any time from the Account page. This permanently removes all your data (blogs, connections, posts, runs, keys) and revokes Google refresh tokens.</li>
          <li>Audit log entries are retained for security and compliance purposes.</li>
          <li>Soft-deleted records (if any) are purged after 30 days.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Your rights</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li><strong>Access:</strong> Export your data from the Account page.</li>
          <li><strong>Deletion:</strong> Delete your account from the Account page.</li>
          <li><strong>Correction:</strong> Update your profile and settings at any time.</li>
          <li><strong>Revoke consent:</strong> Disconnect Blogger or AI connections to stop data processing.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Security</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-neutral-700 mt-2">
          <li>HTTPS enforced via Caddy (automatic TLS).</li>
          <li>Content Security Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy headers on all responses.</li>
          <li>SSRF protection for all outbound requests to user-configured endpoints.</li>
          <li>Rate limiting on authentication, connection tests, and manual runs.</li>
          <li>Secrets never logged (pino redaction) and never sent to the client.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Cookies and tracking</h2>
        <p className="text-sm text-neutral-700 mt-2">
          We use only essential cookies for session management (Auth.js database sessions). No analytics, advertising, or third-party tracking cookies.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Contact</h2>
        <p className="text-sm text-neutral-700 mt-2">
          Questions about this policy or your data? Contact us at <a href="mailto:privacy@example.com" className="underline">privacy@example.com</a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Changes to this policy</h2>
        <p className="text-sm text-neutral-700 mt-2">
          We may update this policy. Changes will be posted here with an updated &ldquo;Last updated&rdquo; date.
        </p>
      </section>

      <hr className="border-neutral-200" />
      <p className="text-sm text-neutral-500">
        <Link href="/terms" className="underline">Terms of Service</Link> ·{' '}
        <Link href="/" className="underline">{appName}</Link>
      </p>
    </main>
  );
}