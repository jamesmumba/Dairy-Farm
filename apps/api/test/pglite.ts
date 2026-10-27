import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createServer } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import type { Db } from '../src/db.js';
import { postgresDb } from '../src/postgresjs.js';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations');

// Just enough of Supabase's own schemas for our migrations to run.
const SUPABASE_STUBS = `
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
`;

/** A fresh Postgres with every migration applied, behind the same Db interface as pg.Pool. */
export async function testDb(): Promise<Db & { pg: PGlite; createAuthUser(id: string): Promise<void> }> {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  const createAuthUser = async (id: string) => {
    await pg.query('insert into auth.users (id) values ($1)', [id]);
  };

  // API_TEST_DRIVER=postgres: the API talks to PGlite over the Postgres wire protocol through
  // postgres.js, configured as in the Edge Function (src/edge.ts).
  if (process.env.API_TEST_DRIVER === 'postgres') {
    const port = await freePort();
    await new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' }).start();
    const sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: 'postgres', max: 1, prepare: false, onnotice: () => {} });
    return { pg, ...postgresDb(sql), createAuthUser };
  }

  const query = async (text: string, params?: unknown[]) => {
    const res = await pg.query(text, params as any[]);
    return { rows: res.rows as any[] };
  };
  return {
    pg,
    query,
    // PGlite is a single session, which is fine for sequential tests.
    connect: async () => ({ query, release: () => {} }),
    createAuthUser,
  };
}
