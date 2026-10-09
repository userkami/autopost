import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Test-time environment. Applied before test files (and their imports) load,
// so modules that parse process.env at import time (src/lib/env.ts) work.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/autoblog_test',
      AUTH_SECRET: 'test-auth-secret-test-auth-secret-test-123456',
      MASTER_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ENABLE_MOCK_PROVIDERS: 'true',
      LOG_LEVEL: 'silent',
    },
  },
});
