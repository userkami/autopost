export default function MaintenancePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">Maintenance in progress</h1>
      <p className="text-neutral-500">
        The site is temporarily paused for maintenance. Administrators can still sign in.
      </p>
    </main>
  );
}
