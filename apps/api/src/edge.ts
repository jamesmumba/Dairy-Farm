// Supabase Edge Function entry (Deno). `npm run build:edge` bundles this file and the API into
// supabase/functions/api/index.js; npm packages are loaded by Deno as `npm:` imports.
//
// Supabase provides SUPABASE_URL, SUPABASE_DB_URL, SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY
// and SUPABASE_JWKS to every function, so no secrets need to be set by hand.
// Served at https://<project>.supabase.co/functions/v1/api/... (the function is named `api`).

import { Hono } from 'hono';
import postgres from 'postgres';
import { pgAccounts } from './accounts.js';
import { buildApp } from './app.js';
import { supabaseTokenVerifier } from './auth.js';
import { postgresDb } from './postgresjs.js';
import { RECEIPT_BUCKET, supabasePhotos } from './photos.js';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const supabaseUrl = env('SUPABASE_URL');
const secretKey = (() => {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0];
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
})();
const jwks = Deno.env.get('SUPABASE_JWKS');

// One small pool per function instance; no prepared statements (connection poolers don't keep them).
const sql = postgres(env('SUPABASE_DB_URL'), { max: 3, prepare: false, idle_timeout: 20, onnotice: () => {} });
const db = postgresDb(sql);

const api = await buildApp({
  verifyToken: supabaseTokenVerifier(supabaseUrl, jwks ? JSON.parse(jwks) : undefined),
  accounts: pgAccounts(db),
  db,
  photos: supabasePhotos(supabaseUrl, secretKey),
  receipts: supabasePhotos(supabaseUrl, secretKey, RECEIPT_BUCKET),
  trustProxy: true, // Supabase's gateway sets X-Forwarded-For
});

Deno.serve(new Hono().route('/api', api).fetch);
