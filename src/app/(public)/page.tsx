export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">AutoBlog</h1>
      <p className="text-lg opacity-70">
        AI research, writing and images — published to your Blogger blogs. Sign in to connect a
        blog, configure your AI roles and schedule posts.
      </p>
      <div className="flex gap-4 text-sm">
        <a
          href="/login"
          className="rounded-md border border-current px-4 py-2 underline underline-offset-4"
        >
          Sign in
        </a>
        <a href="/privacy" className="underline underline-offset-4">
          Privacy
        </a>
        <a href="/terms" className="underline underline-offset-4">
          Terms
        </a>
      </div>
    </main>
  );
}
