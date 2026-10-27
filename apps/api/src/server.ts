// Local development and any Node host: `npm run dev`. Production runs as a Supabase Edge
// Function instead (src/edge.ts).
import { serve } from '@hono/node-server';
import pg from 'pg';
import { loadConfig } from './config.js';
import { supabaseTokenVerifier } from './auth.js';
import { pgAccounts } from './accounts.js';
import { buildApp } from './app.js';
import { RECEIPT_BUCKET, supabasePhotos } from './photos.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

const app = await buildApp({
  verifyToken: supabaseTokenVerifier(config.SUPABASE_URL),
  accounts: pgAccounts(pool),
  db: pool,
  photos: supabasePhotos(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY),
  receipts: supabasePhotos(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, RECEIPT_BUCKET),
  trustProxy: config.TRUST_PROXY === 'true',
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => console.log(`API listening on http://${config.HOST}:${info.port}`));

// Stop cleanly: finish in-flight requests, then close the database pool.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
}
