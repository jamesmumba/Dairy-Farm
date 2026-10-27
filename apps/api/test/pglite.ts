import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../src/db.js';

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
  const query = async (text: string, params?: unknown[]) => {
    const res = await pg.query(text, params as any[]);
    return { rows: res.rows as any[] };
  };
  return {
    pg,
    query,
    // PGlite is a single session, which is fine for sequential tests.
    connect: async () => ({ query, release: () => {} }),
    createAuthUser: async (id) => {
      await pg.query('insert into auth.users (id) values ($1)', [id]);
    },
  };
}
