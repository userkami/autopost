import type { MockInstance } from 'vitest';
import { request } from 'undici';

/**
 * Shared undici test utilities. Each suite declares at top level:
 *
 *   vi.mock('undici', async (importOriginal) => ({
 *     ...(await importOriginal<typeof import('undici')>()),
 *     request: vi.fn(),
 *   }));
 *
 * then imports `mockedRequest` / `queueResponses` from here. `request` resolves
 * to the mock because the module registry is already patched when this file runs.
 */

type MockResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  text?: string;
  chunks?: Buffer[];
};

export function httpResponse({ statusCode = 200, headers = {}, text = '', chunks }: MockResponse) {
  const bodyChunks = chunks ?? (text ? [Buffer.from(text)] : []);
  return {
    statusCode,
    headers,
    body: {
      text: async () => text,
      async *[Symbol.asyncIterator]() {
        for (const chunk of bodyChunks) yield chunk;
      },
    },
  };
}

export const mockedRequest = request as unknown as MockInstance;

export function queueResponses(...responses: MockResponse[]) {
  mockedRequest.mockReset();
  for (const response of responses) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedRequest as any).mockResolvedValueOnce(httpResponse(response));
  }
}