import { z } from 'zod';
import { audit, type DbClient, type Queryable } from './db.js';
import { HttpError } from './http.js';
import { decimal, pastDate, reason } from './validation.js';

// Milk stock is a signed ledger (milk_stock_movements). Closing stock on a day is the sum of
// all movements up to that day:
//   closing = opening + eligible production − sales − other uses ± adjustments.
// Production movements come from milk entries (Stage 4), sale movements from sales; this
// module records the rest and answers "how much can still go out on this date?".

export const MOVEMENT_COLUMNS = `id, movement_date::text, occurred_at, kind, quantity::text, reason, milk_production_id, sale_id,
  reverses_id, created_at, updated_at`;

const USES = ['farm_consumption', 'calf_feeding', 'spoilage', 'gift', 'other_use'] as const;

export const MovementCreate = z
  .object({
    id: z.uuid(),
    kind: z.enum([...USES, 'adjustment', 'opening_balance']),
    quantity: decimal(7).refine((q) => Number(q) > 0, 'Litres must be more than 0'),
    // Adjustments add or remove; uses always remove; an opening balance always adds.
    direction: z.enum(['add', 'remove']).optional(),
    movement_date: pastDate,
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((m) => m.kind !== 'adjustment' || m.direction, { message: 'Choose whether the adjustment adds or removes milk', path: ['direction'] })
  .refine((m) => !['adjustment', 'opening_balance', 'other_use'].includes(m.kind) || (m.reason && m.reason.length >= 3), {
    message: 'Say why (for an opening balance: where the figure comes from)',
    path: ['reason'],
  });

export const MovementReverse = z.object({ id: z.uuid(), reason }).strict();

/** The farm-local calendar date of a moment. */
export async function farmDate(client: Queryable, owner: string, at: string): Promise<string> {
  const { rows } = await client.query<{ d: string }>(
    `select ($2::timestamptz at time zone (select time_zone from public.farmer_accounts where id = $1))::date::text as d`,
    [owner, at],
  );
  return rows[0].d;
}

/**
 * Litres that can still leave stock on `date` without any day's closing stock going below
 * zero: the lower of the closing on that date and every later closing (a back-dated sale
 * also reduces all later days).
 */
export async function available(client: Queryable, owner: string, date: string): Promise<string> {
  const { rows } = await client.query<{ litres: string }>(
    `with daily as (
       select movement_date d, sum(quantity) q from public.milk_stock_movements where owner_id = $1 group by movement_date
     ), running as (
       select d, sum(q) over (order by d) closing from daily
     )
     select round(greatest(0, least(
       coalesce((select closing from running where d <= $2 order by d desc limit 1), 0),
       coalesce((select min(closing) from running where d >= $2), 'infinity'::numeric)
     )), 2)::text as litres`,
    [owner, date],
  );
  return rows[0].litres;
}

/** Throws 409 insufficient_stock unless `litres` can leave stock on `date`. */
export async function requireStock(client: Queryable, owner: string, date: string, litres: string) {
  const can = await available(client, owner, date);
  if (Number(litres) > Number(can)) {
    throw new HttpError(
      409,
      'insufficient_stock',
      `Only ${can} L of saleable milk is in stock for ${date}. Record the production, or make a stock adjustment with a reason, before this can go out.`,
      { available: can, requested: litres, date },
    );
  }
}

export async function insertMovement(
  client: DbClient,
  owner: string,
  m: { id?: string; kind: string; date: string; quantity: string; reason?: string | null; sale_id?: string | null; reverses_id?: string | null },
) {
  const { rows } = await client.query(
    `insert into public.milk_stock_movements (id, owner_id, movement_date, kind, quantity, reason, sale_id, reverses_id)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) returning ${MOVEMENT_COLUMNS}`,
    [m.id ?? null, owner, m.date, m.kind, m.quantity, m.reason ?? null, m.sale_id ?? null, m.reverses_id ?? null],
  );
  return rows[0];
}

export async function createMovement(client: DbClient, owner: string, actor: string, input: z.infer<typeof MovementCreate>) {
  const { rows: clash } = await client.query('select 1 from public.milk_stock_movements where id = $1', [input.id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');
  const outgoing = (USES as readonly string[]).includes(input.kind) || (input.kind === 'adjustment' && input.direction === 'remove');
  if (outgoing) await requireStock(client, owner, input.movement_date, input.quantity);
  const row = await insertMovement(client, owner, {
    id: input.id,
    kind: input.kind,
    date: input.movement_date,
    quantity: outgoing ? `-${input.quantity}` : input.quantity,
    reason: input.reason ?? null,
  });
  await audit(client, { ownerId: owner, actorUserId: actor, action: `stock.${input.kind}`, entityTable: 'milk_stock_movements', entityId: row.id, reason: input.reason ?? null, after: row });
  return row;
}

/** Undoes a mistaken use, adjustment or opening balance by an opposite movement. */
export async function reverseMovement(client: DbClient, owner: string, actor: string, targetId: string, input: z.infer<typeof MovementReverse>) {
  const { rows } = await client.query<{ kind: string; quantity: string; movement_date: string }>(
    `select kind, quantity::text, movement_date::text from public.milk_stock_movements where owner_id = $1 and id = $2`,
    [owner, targetId],
  );
  const target = rows[0];
  if (!target) throw new HttpError(404, 'not_found', 'Stock record not found.');
  if (['production', 'sale', 'reversal'].includes(target.kind)) {
    throw new HttpError(409, 'not_reversible', 'Production and sales change stock through their own records: correct or void the milk entry or the sale instead.');
  }
  const { rows: done } = await client.query('select 1 from public.milk_stock_movements where reverses_id = $1', [targetId]);
  if (done[0]) throw new HttpError(409, 'already_reversed', 'This stock record was already reversed.');
  const quantity = target.quantity.startsWith('-') ? target.quantity.slice(1) : `-${target.quantity}`;
  if (quantity.startsWith('-')) await requireStock(client, owner, target.movement_date, quantity.slice(1));
  const row = await insertMovement(client, owner, { id: input.id, kind: 'reversal', date: target.movement_date, quantity, reason: input.reason, reverses_id: targetId });
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'stock.reversed', entityTable: 'milk_stock_movements', entityId: targetId, reason: input.reason, after: row });
  return row;
}
