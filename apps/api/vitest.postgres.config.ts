import { defineConfig } from 'vitest/config';

// The whole API suite again, through postgres.js over a real Postgres socket (the Edge Function's driver).
export default defineConfig({ test: { env: { API_TEST_DRIVER: 'postgres' }, testTimeout: 30_000, hookTimeout: 60_000 } });
