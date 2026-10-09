import pino, { type LoggerOptions } from 'pino';
import { env } from './env';

/**
 * pino logger with secret redaction (PLAN.md §14.10).
 * Never log request bodies of provider calls or any raw secret.
 */
const REDACT_PATHS = [
  // pino's `*` wildcard matches exactly one nesting level, so every secret
  // key gets both a top-level and a one-level-nested entry.
  'authorization',
  '*.authorization',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'api_key_enc',
  '*.api_key_enc',
  'refresh_token_enc',
  '*.refresh_token_enc',
  'config_enc',
  '*.config_enc',
  'extra_enc',
  '*.extra_enc',
  'secret',
  '*.secret',
  'password',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
];

export function createLogger(
  options: LoggerOptions = {},
  stream?: pino.DestinationStream,
): pino.Logger {
  return pino(
    {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      ...options,
    },
    stream,
  );
}

export const logger = createLogger();
