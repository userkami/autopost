import { PgBoss } from 'pg-boss';

/**
 * Singleton pg-boss instance for sending jobs from the Next.js app.
 * The worker uses its own instance for processing.
 */
let bossInstance: PgBoss | null = null;

export async function getJobSender(): Promise<PgBoss> {
  if (!bossInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not set - cannot send jobs');
    }
    bossInstance = new PgBoss(connectionString);
    await bossInstance.start();
  }
  return bossInstance;
}

export async function enqueueRunExecute(runId: string): Promise<void> {
  const boss = await getJobSender();
  await boss.send('run.execute', { runId });
}