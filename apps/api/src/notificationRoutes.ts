import { z } from 'zod';
import type { Db } from './db.js';
import { parse } from './http.js';
import type { Router } from './router.js';

// Read marks for the in-app notifications inbox, shared by every phone on the account. The items themselves
// are worked out on each phone from the records; only "the farmer has read this one" is stored.

const Key = z.string().min(1).max(200);
const MarkRead = z.object({ keys: z.array(Key).min(1).max(200) }).strict();
const ReadQuery = z.object({ since: z.iso.datetime({ offset: true }).optional() }).strict();

/** How long read marks are kept: older items have long since dropped out of the inbox. */
const KEEP_DAYS = 120;

export function notificationRoutes(v1: Router, { db }: { db: Db }) {
  v1.get('/notifications/read', async (req) => {
    const owner = req.farmer.account.id;
    const { since } = parse(ReadQuery, req.query);
    const { rows } = await db.query(
      `select key from public.notification_reads
       where owner_id = $1 and read_at > coalesce($2::timestamptz, now() - make_interval(days => $3))
       order by read_at desc limit 2000`,
      [owner, since ?? null, KEEP_DAYS],
    );
    return { keys: rows.map((r: { key: string }) => r.key) };
  });

  // Marking read twice is harmless (it keeps the first time), so retries need no idempotency key.
  v1.post('/notifications/read', async (req) => {
    const owner = req.farmer.account.id;
    const { keys } = parse(MarkRead, req.body);
    await db.query(
      `insert into public.notification_reads (owner_id, key) select $1, unnest($2::text[]) on conflict do nothing`,
      [owner, [...new Set(keys)]],
    );
    // Tidy as we go, so the table never grows without bound.
    await db.query(`delete from public.notification_reads where owner_id = $1 and read_at < now() - make_interval(days => $2)`, [owner, KEEP_DAYS]);
    return { saved: keys.length };
  });
}
