// Processes a farmer's account deletion request. Run by an operator, never by the app.
//
//   npm run erase-account -- <farmer_account_id>            (dry run: shows what would go)
//   npm run erase-account -- <farmer_account_id> --confirm  (erases)
//
// Needs DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).
// Order: database rows first (one transaction, all or nothing), then stored photos and
// receipts, then the sign-in. If a later step fails, re-running finishes it.

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { PHOTO_BUCKET, RECEIPT_BUCKET } from '../src/photos.js';

const [ownerId, flag] = process.argv.slice(2);
if (!ownerId || !/^[0-9a-f-]{36}$/i.test(ownerId)) {
  console.error('Usage: npm run erase-account -- <farmer_account_id> [--confirm]');
  process.exit(1);
}
const confirm = flag === '--confirm';
const config = loadConfig();
const db = new pg.Client({ connectionString: config.DATABASE_URL });
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

/** Every object under <owner>/ (paths are <owner>/<record>/<file>). */
async function objects(bucket: string): Promise<string[]> {
  const storage = supabase.storage.from(bucket);
  const { data: folders, error } = await storage.list(ownerId, { limit: 1000 });
  if (error) throw error;
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files, error: e2 } = await storage.list(`${ownerId}/${folder.name}`, { limit: 1000 });
    if (e2) throw e2;
    paths.push(...(files ?? []).map((f) => `${ownerId}/${folder.name}/${f.name}`));
  }
  return paths;
}

async function main() {
  await db.connect();
  const { rows } = await db.query<{ auth_user_id: string; deletion_requested_at: Date | null }>(
    'select auth_user_id, deletion_requested_at from public.farmer_accounts where id = $1',
    [ownerId],
  );
  const account = rows[0];
  const photos = await objects(PHOTO_BUCKET);
  const receipts = await objects(RECEIPT_BUCKET);

  if (!account) {
    console.log('No farmer account with that id (already erased?). Remaining stored files:', photos.length + receipts.length);
  } else {
    if (!account.deletion_requested_at) throw new Error('This farmer has not requested deletion. Nothing done.');
    console.log(`Deletion requested: ${account.deletion_requested_at.toISOString()}`);
  }
  console.log(`Stored files: ${photos.length} animal photos, ${receipts.length} receipts`);
  if (!confirm) {
    console.log('Dry run. Re-run with --confirm to erase.');
    return;
  }

  if (account) {
    await db.query('begin');
    const { rows: erased } = await db.query<{ n: number }>('select public.erase_farmer_account($1) as n', [ownerId]);
    await db.query('commit');
    console.log(`Erased ${erased[0].n} database rows.`);
  }
  for (const [bucket, paths] of [[PHOTO_BUCKET, photos], [RECEIPT_BUCKET, receipts]] as const) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
  }
  console.log(`Removed ${photos.length + receipts.length} stored files.`);
  if (account) {
    const { error } = await supabase.auth.admin.deleteUser(account.auth_user_id);
    if (error) throw error;
    console.log('Removed the sign-in (all sessions end).');
  }
  console.log('Done. An anonymous receipt is in public.account_deletions.');
}

main()
  .catch((err) => {
    console.error('Stopped:', err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
