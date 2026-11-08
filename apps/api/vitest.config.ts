import { defineConfig } from 'vitest/config';

// Each test file starts its own in-memory Postgres and applies every migration; with all files starting
// at once on a busy machine that can pass the default 10 s.
export default defineConfig({ test: { hookTimeout: 60_000 } });
