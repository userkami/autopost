export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">AutoBlog</h1>
      <p className="text-lg opacity-70">
        Scaffold ready. AI research, writing and images — published to your Blogger blogs.
      </p>
      <a
        href="/api/health"
        className="rounded-md border border-current px-4 py-2 text-sm underline underline-offset-4"
      >
        /api/health
      </a>
    </main>
  );
}
