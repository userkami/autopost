export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'bad_request'
  | 'not_found'
  | 'content_policy'
  | 'timeout'
  | 'server'
  | 'unsupported';

/** User-safe provider error. Never put API keys or raw request bodies here. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(kind: ProviderErrorKind, message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status;
    this.retryable = kind === 'rate_limit' || kind === 'timeout' || kind === 'server';
  }
}

export function providerErrorFromStatus(status: number, fallback = 'Provider request failed'): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', 'Authentication failed', { status });
  if (status === 404) return new ProviderError('not_found', 'Requested provider resource was not found', { status });
  if (status === 408 || status === 504) return new ProviderError('timeout', 'Provider request timed out', { status });
  if (status === 429) return new ProviderError('rate_limit', 'Provider rate limit reached', { status });
  if (status === 402) return new ProviderError('quota', 'Provider quota or billing limit reached', { status });
  if (status >= 500) return new ProviderError('server', 'Provider service is unavailable', { status });
  if (status >= 400) return new ProviderError('bad_request', fallback, { status });
  return new ProviderError('server', fallback, { status });
}

export function toProviderError(error: unknown, fallback = 'Provider request failed'): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ProviderError('timeout', 'Provider request timed out', { cause: error });
  }
  if (error instanceof Error && /timeout|aborted/i.test(error.message)) {
    return new ProviderError('timeout', 'Provider request timed out', { cause: error });
  }
  return new ProviderError('server', fallback, { cause: error });
}