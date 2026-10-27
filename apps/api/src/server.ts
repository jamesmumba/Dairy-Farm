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
  logLevel: config.LOG_LEVEL,
  trustProxy: config.TRUST_PROXY === 'true',
});

// Hosts stop the API with SIGTERM: finish in-flight requests, then close the database pool.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
