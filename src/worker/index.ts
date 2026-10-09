import { logger } from '../lib/logger';

/**
 * Worker entrypoint (PLAN.md §3).
 * Phase 0: heartbeat placeholder. Phase 5/6 registers the pg-boss jobs
 * (run.execute, schedule tick, review.expire).
 */
logger.info('worker started');

const heartbeat = setInterval(() => {
  logger.debug('worker heartbeat');
}, 30_000);

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'worker shutting down');
  clearInterval(heartbeat);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
