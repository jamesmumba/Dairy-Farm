import { z } from 'zod';
import { BREED_COLUMNS } from './breeds.js';
import { CATTLE_COLUMNS } from './cattle.js';
import type { Db } from './db.js';
import { MILK_COLUMNS } from './milk.js';
import { CARE_ENTITIES } from './care.js';
import { ALLOCATION_COLUMNS, CUSTOMER_COLUMNS, EXPENSE_COLUMNS, PAYMENT_COLUMNS, PRICE_COLUMNS, SALE_COLUMNS } from './finance.js';
import { MOVEMENT_COLUMNS } from './stock.js';

// Tables the app keeps a working copy of. Later stages add theirs here.
const ENTITIES: Record<string, { table: string; columns: string }> = {
  cattle_breeds: { table: 'cattle_breeds', columns: BREED_COLUMNS },
  cattle: { table: 'cattle', columns: CATTLE_COLUMNS },
  milk_production: { table: 'milk_production', columns: MILK_COLUMNS },
  ...Object.fromEntries(CARE_ENTITIES.map((e) => [e.table, { table: e.table, columns: e.columns }])),
  customers: { table: 'customers', columns: CUSTOMER_COLUMNS },
  milk_prices: { table: 'milk_prices', columns: PRICE_COLUMNS },
  milk_sales: { table: 'milk_sales', columns: SALE_COLUMNS },
  payments: { table: 'payments', columns: PAYMENT_COLUMNS },
  payment_allocations: { table: 'payment_allocations', columns: ALLOCATION_COLUMNS },
  milk_stock_movements: { table: 'milk_stock_movements', columns: MOVEMENT_COLUMNS },
  farm_expenses: { table: 'farm_expenses', columns: EXPENSE_COLUMNS },
};

export const PullQuery = z
  .object({
    entity: z.enum(Object.keys(ENTITIES) as [string, ...string[]]),
    // Cursor from the previous page: the last row's updated_at (full precision text) and id.
    after: z.string().max(40).optional(),
    after_id: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

export interface PullPage {
  rows: Record<string, unknown>[];
  /** Cursor after the last row returned (null when no rows): pass it back next time. */
  next: { after: string; after_id: string } | null;
  has_more: boolean;
}

/**
 * Rows changed after the cursor, oldest first. Soft-deleted rows are included so other
 * phones remove them. The cursor keeps microsecond precision so paging never repeats or skips.
 */
export async function pull(db: Db, ownerId: string, q: z.infer<typeof PullQuery>): Promise<PullPage> {
  const { table, columns } = ENTITIES[q.entity];
  // The cursor goes in as text and is cast in SQL: typed as a timestamp, postgres.js would round it to the
  // millisecond, and rows saved in one transaction (same microsecond) would come back on every page.
  const cursor = q.after ? 'and (updated_at, id) > ($2::text::timestamptz, $3::text::uuid)' : '';
  const params = q.after ? [ownerId, q.after, q.after_id ?? '00000000-0000-0000-0000-000000000000'] : [ownerId];
  const { rows } = await db.query<Record<string, unknown> & { _cursor: string }>(
    `select ${columns}, updated_at::text as _cursor from public.${table}
     where owner_id = $1 ${cursor}
     order by updated_at, id
     limit ${q.limit}`,
    params,
  );
  const last = rows[rows.length - 1];
  return {
    rows: rows.map(({ _cursor, ...row }) => row),
    next: last ? { after: last._cursor, after_id: last.id as string } : null,
    has_more: rows.length === q.limit,
  };
}
