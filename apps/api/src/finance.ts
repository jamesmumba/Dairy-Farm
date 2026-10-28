import { z } from 'zod';
import { audit, type DbClient, type Queryable } from './db.js';
import { HttpError } from './http.js';
import { CURRENCIES } from './profile.js';
import { farmDate, insertMovement, requireStock } from './stock.js';
import { decimal, pastDate, reason, text } from './validation.js';

// Money is NUMERIC in the database and a decimal string in JSON. Comparisons in code use
// whole cents (integers); sums are done in SQL. Currencies are never added together.

const cents = (amount: string) => {
  const [whole, frac = ''] = amount.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
};
const fromCents = (c: number) => `${Math.trunc(c / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;

const pastDateTime = z.iso.datetime({ offset: true }).refine((d) => Date.parse(d) <= Date.now() + 86_400_000, 'Date cannot be in the future');
const money = decimal(12).refine((m) => Number(m) > 0, 'Amount must be more than 0');
const METHODS = ['cash', 'mobile_money', 'bank_transfer', 'card', 'credit', 'other'] as const;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const CUSTOMER_COLUMNS = 'id, name, phone, address, customer_type, registered_on::text, notes, active, version, created_at, updated_at';

const customerFields = {
  name: z.string().trim().min(1, 'Enter the customer’s name').max(120),
  phone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Enter a phone number, e.g. +260 97 123 4567').nullable().optional().or(z.literal('').transform(() => null)),
  address: text(200),
  customer_type: z.enum(['individual', 'business', 'school', 'cooperative', 'other']).optional(),
  registered_on: pastDate.optional(),
  notes: text(1000),
  active: z.boolean().optional(),
};
export const CustomerCreate = z.object({ id: z.uuid(), ...customerFields }).strict();
export const CustomerUpdate = z.object(customerFields).partial().strict();

export async function createCustomer(client: DbClient, owner: string, actor: string, input: z.infer<typeof CustomerCreate>) {
  const { rows: clash } = await client.query('select 1 from public.customers where id = $1', [input.id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');
  const keys = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined && k !== 'id');
  const { rows } = await client.query(
    `insert into public.customers (owner_id, id${keys.map((k) => `, ${k}`).join('')}) values ($1, $2${keys.map((_, i) => `, $${i + 3}`).join('')})
     returning ${CUSTOMER_COLUMNS}`,
    [owner, input.id, ...keys.map((k) => input[k as keyof typeof input])],
  );
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'customer.created', entityTable: 'customers', entityId: input.id, after: rows[0] });
  return rows[0];
}

export async function getCustomer(client: Queryable, owner: string, id: string, forUpdate = false) {
  const { rows } = await client.query(`select ${CUSTOMER_COLUMNS} from public.customers where owner_id = $1 and id = $2 ${forUpdate ? 'for update' : ''}`, [owner, id]);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Customer not found.');
  return rows[0];
}

export async function updateCustomer(client: DbClient, owner: string, actor: string, id: string, version: number, patch: z.infer<typeof CustomerUpdate>) {
  const before = await getCustomer(client, owner, id, true);
  if (before.version !== version) throw new HttpError(409, 'version_conflict', 'This customer was changed elsewhere. Review the latest version.', { current: before });
  const changed = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined && String(patch[k as keyof typeof patch]) !== String(before[k]));
  if (!changed.length) return before;
  const { rows } = await client.query(
    `update public.customers set ${changed.map((k, i) => `${k} = $${i + 3}`).join(', ')} where owner_id = $1 and id = $2 returning ${CUSTOMER_COLUMNS}`,
    [owner, id, ...changed.map((k) => patch[k as keyof typeof patch])],
  );
  await audit(client, {
    ownerId: owner,
    actorUserId: actor,
    action: 'customer.updated',
    entityTable: 'customers',
    entityId: id,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, rows[0][k]])),
  });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Prices (append-only history)
// ---------------------------------------------------------------------------

export const PRICE_COLUMNS = 'id, currency, price_per_litre::text, effective_from, reason, created_at, updated_at';

export const PriceCreate = z
  .object({
    id: z.uuid(),
    currency: z.enum(CURRENCIES),
    price_per_litre: decimal(8).refine((p) => Number(p) > 0, 'Price must be more than 0'),
    effective_from: z.iso.datetime({ offset: true }),
    reason: text(300),
  })
  .strict();

export async function createPrice(client: DbClient, owner: string, actor: string, input: z.infer<typeof PriceCreate>) {
  const { rows } = await client.query(
    `insert into public.milk_prices (id, owner_id, currency, price_per_litre, effective_from, reason) values ($1, $2, $3, $4, $5, $6)
     returning ${PRICE_COLUMNS}`,
    [input.id, owner, input.currency, input.price_per_litre, input.effective_from, input.reason ?? null],
  ).catch((err) => {
    if (String(err?.message).includes('milk_prices_owner_id_currency_effective_from_key') || err?.code === '23505') {
      throw new HttpError(409, 'price_exists', 'A price for this currency already starts at that moment.');
    }
    throw err;
  });
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'milk_price.set', entityTable: 'milk_prices', entityId: input.id, reason: input.reason ?? null, after: rows[0] });
  return rows[0];
}

async function listPrice(client: Queryable, owner: string, currency: string, at: string) {
  const { rows } = await client.query<{ id: string; price_per_litre: string }>(
    `select id, price_per_litre::text from public.milk_prices where owner_id = $1 and currency = $2 and effective_from <= $3
     order by effective_from desc limit 1`,
    [owner, currency, at],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Allocation: payments pay the oldest unpaid sales first; the rest is credit.
// ---------------------------------------------------------------------------

/**
 * Re-applies a customer's unallocated credit (completed payments and adjustments, less
 * refunds) to their unpaid completed sales, oldest first. Idempotent: run after any change.
 */
export async function allocate(client: DbClient, owner: string, customerId: string, currency: string) {
  const { rows: credits } = await client.query<{ id: string; free: string }>(
    `select p.id, (p.amount - coalesce((select sum(a.amount) from public.payment_allocations a
                                       join public.milk_sales s on s.id = a.sale_id and s.status = 'completed'
                                       where a.payment_id = p.id), 0))::text as free
     from public.payments p
     where p.owner_id = $1 and p.customer_id = $2 and p.currency = $3 and p.status = 'completed' and p.kind in ('payment', 'adjustment')
     order by p.paid_at, p.created_at`,
    [owner, customerId, currency],
  );
  const { rows: refunds } = await client.query<{ total: string }>(
    `select coalesce(sum(amount), 0)::text as total from public.payments
     where owner_id = $1 and customer_id = $2 and currency = $3 and status = 'completed' and kind = 'refund'`,
    [owner, customerId, currency],
  );
  const { rows: sales } = await client.query<{ id: string; due: string }>(
    `select s.id, (s.total - coalesce((select sum(a.amount) from public.payment_allocations a
                                      join public.payments p on p.id = a.payment_id and p.status = 'completed'
                                      where a.sale_id = s.id), 0))::text as due
     from public.milk_sales s
     where s.owner_id = $1 and s.customer_id = $2 and s.currency = $3 and s.status = 'completed'
     order by s.sale_at, s.created_at`,
    [owner, customerId, currency],
  );

  // Money refunded came out of the oldest credit; that part is gone, not available for sales.
  let refunded = cents(refunds[0].total);
  const pool = credits.map((c) => {
    const take = Math.min(refunded, Math.max(0, cents(c.free)));
    refunded -= take;
    return { id: c.id, free: cents(c.free) - take };
  });

  for (const sale of sales) {
    let due = cents(sale.due);
    for (const c of pool) {
      if (due <= 0) break;
      if (c.free <= 0) continue;
      const amount = Math.min(due, c.free);
      await client.query('insert into public.payment_allocations (owner_id, payment_id, sale_id, amount) values ($1, $2, $3, $4)', [owner, c.id, sale.id, fromCents(amount)]);
      c.free -= amount;
      due -= amount;
    }
  }
}

/** sales − payments − adjustments + refunds, per currency. Positive = the customer owes. */
export async function balances(client: Queryable, owner: string, customerId: string) {
  const { rows } = await client.query<{ currency: string; balance: string }>(
    `select currency, sum(v)::text as balance from (
       select currency, total as v from public.milk_sales where owner_id = $1 and customer_id = $2 and status = 'completed'
       union all
       select currency, case kind when 'refund' then amount else -amount end from public.payments
        where owner_id = $1 and customer_id = $2 and status = 'completed'
     ) x group by currency`,
    [owner, customerId],
  );
  return Object.fromEntries(rows.map((r) => [r.currency, r.balance]));
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const ALLOCATION_COLUMNS = 'id, payment_id, sale_id, amount::text, created_at, updated_at';

export const PAYMENT_COLUMNS = `id, customer_id, kind, amount::text, currency, method, paid_at, reference, notes, reason, status, void_reason, voided_at,
  created_at, updated_at`;

export const PaymentCreate = z
  .object({
    id: z.uuid(),
    customer_id: z.uuid(),
    kind: z.enum(['payment', 'refund', 'adjustment']),
    amount: money,
    currency: z.enum(CURRENCIES),
    method: z.enum(METHODS),
    paid_at: pastDateTime,
    reference: text(120),
    notes: text(1000),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((p) => p.kind === 'payment' || (p.reason && p.reason.length >= 3), { message: 'Say why', path: ['reason'] });

export const VoidBody = z.object({ reason }).strict();

export async function createPayment(client: DbClient, owner: string, actor: string, input: z.infer<typeof PaymentCreate>) {
  await getCustomer(client, owner, input.customer_id, true); // also serialises payments per customer
  const { rows: clash } = await client.query('select 1 from public.payments where id = $1', [input.id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');

  const owed = cents((await balances(client, owner, input.customer_id))[input.currency] ?? '0');
  if (input.kind === 'refund' && cents(input.amount) > -owed) {
    throw new HttpError(400, 'validation_failed', `A refund cannot be more than the customer’s credit (${fromCents(Math.max(0, -owed))} ${input.currency}).`, { field: 'amount' });
  }
  if (input.kind === 'adjustment' && cents(input.amount) > owed) {
    throw new HttpError(400, 'validation_failed', `An adjustment cannot be more than what the customer owes (${fromCents(Math.max(0, owed))} ${input.currency}).`, { field: 'amount' });
  }
  const { rows } = await client.query(
    `insert into public.payments (id, owner_id, customer_id, kind, amount, currency, method, paid_at, reference, notes, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning ${PAYMENT_COLUMNS}`,
    [input.id, owner, input.customer_id, input.kind, input.amount, input.currency, input.method, input.paid_at, input.reference ?? null, input.notes ?? null, input.reason ?? null],
  );
  await allocate(client, owner, input.customer_id, input.currency);
  await audit(client, { ownerId: owner, actorUserId: actor, action: `payment.${input.kind}`, entityTable: 'payments', entityId: input.id, reason: input.reason ?? null, after: rows[0] });
  return rows[0];
}

export async function voidPayment(client: DbClient, owner: string, actor: string, id: string, why: string) {
  const { rows: found } = await client.query(`select ${PAYMENT_COLUMNS} from public.payments where owner_id = $1 and id = $2 for update`, [owner, id]);
  const before = found[0];
  if (!before) throw new HttpError(404, 'not_found', 'Payment not found.');
  if (before.status === 'voided') throw new HttpError(409, 'voided', 'This payment was already voided.');
  const { rows } = await client.query(
    `update public.payments set status = 'voided', void_reason = $3, voided_at = now() where owner_id = $1 and id = $2 returning ${PAYMENT_COLUMNS}`,
    [owner, id, why],
  );
  await allocate(client, owner, before.customer_id, before.currency);
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'payment.voided', entityTable: 'payments', entityId: id, reason: why, before, after: { status: 'voided' } });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const SALE_COLUMNS = `id, customer_id, sale_at, quantity::text, price_per_litre::text, currency, total::text, price_id, price_source, payment_method,
  notes, status, void_reason, voided_at, corrects_sale_id, created_at, updated_at`;

const saleFields = {
  customer_id: z.uuid(),
  sale_at: pastDateTime,
  quantity: decimal(6).refine((q) => Number(q) > 0, 'Litres must be more than 0'),
  currency: z.enum(CURRENCIES),
  // Omit to use the listed price for the sale's currency and time.
  price_per_litre: decimal(8).refine((p) => Number(p) > 0, 'Price must be more than 0').optional(),
  payment_method: z.enum(METHODS).optional(),
  amount_paid: decimal(12).optional(),
  payment_id: z.uuid().optional(),
  notes: text(1000),
};
export const SaleCreate = z.object({ id: z.uuid(), ...saleFields }).strict();
export const SaleCorrect = z
  .object({ new_id: z.uuid(), ...Object.fromEntries(Object.entries(saleFields).map(([k, v]) => [k, (v as z.ZodType).optional()])), reason })
  .strict();

type SaleInput = z.infer<typeof SaleCreate>;

async function insertSale(client: DbClient, owner: string, input: SaleInput, correctsId: string | null) {
  await getCustomer(client, owner, input.customer_id, true);
  const listed = input.price_per_litre ? null : await listPrice(client, owner, input.currency, input.sale_at);
  if (!input.price_per_litre && !listed) {
    throw new HttpError(400, 'no_price', `No ${input.currency} milk price is set for this date. Set a price first, or enter the price for this sale.`, { field: 'price_per_litre' });
  }
  const price = input.price_per_litre ?? listed!.price_per_litre;
  const { rows: totals } = await client.query<{ total: string }>('select round($1::numeric * $2::numeric, 2)::text as total', [input.quantity, price]);
  const total = totals[0].total;
  const paid = input.amount_paid ?? '0';
  if (cents(paid) > cents(total)) {
    throw new HttpError(400, 'validation_failed', `Amount paid is more than the total (${total} ${input.currency}). Record extra money as a separate payment.`, { field: 'amount_paid' });
  }
  if (cents(paid) > 0 && !input.payment_method) throw new HttpError(400, 'validation_failed', 'Choose how the customer paid.', { field: 'payment_method' });

  const date = await farmDate(client, owner, input.sale_at);
  await requireStock(client, owner, date, input.quantity);

  const { rows } = await client.query(
    `insert into public.milk_sales (id, owner_id, customer_id, sale_at, quantity, price_per_litre, currency, total, price_id, price_source,
       payment_method, notes, corrects_sale_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning ${SALE_COLUMNS}`,
    [
      input.id,
      owner,
      input.customer_id,
      input.sale_at,
      input.quantity,
      price,
      input.currency,
      total,
      listed?.id ?? null,
      input.price_per_litre ? 'override' : 'list',
      input.payment_method ?? null,
      input.notes ?? null,
      correctsId,
    ],
  );
  // Same id as the sale, so the app can match its offline copy to the server's movement.
  await insertMovement(client, owner, { id: input.id, kind: 'sale', date, quantity: `-${input.quantity}`, sale_id: input.id });
  if (cents(paid) > 0) {
    await client.query(
      `insert into public.payments (id, owner_id, customer_id, kind, amount, currency, method, paid_at, notes)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $3, 'payment', $4, $5, $6, $7, 'Paid at sale')`,
      [input.payment_id ?? null, owner, input.customer_id, paid, input.currency, input.payment_method, input.sale_at],
    );
  }
  await allocate(client, owner, input.customer_id, input.currency);
  return rows[0];
}

export async function createSale(client: DbClient, owner: string, actor: string, input: SaleInput) {
  const { rows: clash } = await client.query('select 1 from public.milk_sales where id = $1', [input.id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');
  const sale = await insertSale(client, owner, input, null);
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'milk_sale.created', entityTable: 'milk_sales', entityId: sale.id, after: sale });
  return sale;
}

async function voidSaleRow(client: DbClient, owner: string, id: string, why: string) {
  const { rows: found } = await client.query(`select ${SALE_COLUMNS} from public.milk_sales where owner_id = $1 and id = $2 for update`, [owner, id]);
  const before = found[0];
  if (!before) throw new HttpError(404, 'not_found', 'Sale not found.');
  if (before.status === 'voided') throw new HttpError(409, 'voided', 'This sale was already voided.');
  const { rows } = await client.query(
    `update public.milk_sales set status = 'voided', void_reason = $3, voided_at = now() where owner_id = $1 and id = $2 returning ${SALE_COLUMNS}`,
    [owner, id, why],
  );
  // The milk goes back into stock.
  const { rows: mv } = await client.query<{ id: string; movement_date: string; quantity: string }>(
    `select id, movement_date::text, quantity::text from public.milk_stock_movements where sale_id = $1 and kind = 'sale'`,
    [id],
  );
  for (const m of mv) {
    await insertMovement(client, owner, { kind: 'reversal', date: m.movement_date, quantity: m.quantity.slice(1), reason: `Sale voided: ${why}`, reverses_id: m.id });
  }
  return { before, after: rows[0] };
}

export async function voidSale(client: DbClient, owner: string, actor: string, id: string, why: string) {
  const { before, after } = await voidSaleRow(client, owner, id, why);
  // Money already received for it becomes credit and is re-applied.
  await allocate(client, owner, before.customer_id, before.currency);
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'milk_sale.voided', entityTable: 'milk_sales', entityId: id, reason: why, before, after: { status: 'voided' } });
  return after;
}

/** Voids the original and records the corrected sale linked to it; both are kept. */
export async function correctSale(client: DbClient, owner: string, actor: string, id: string, input: z.infer<typeof SaleCorrect>) {
  const { before } = await voidSaleRow(client, owner, id, `Corrected: ${input.reason}`);
  const { new_id, reason: why, ...changes } = input as Record<string, unknown> & { new_id: string; reason: string };
  const sameCurrency = !changes.currency || changes.currency === before.currency;
  const keepPrice = before.price_source === 'override' && sameCurrency && !changes.price_per_litre;
  const next: SaleInput = {
    id: new_id,
    customer_id: (changes.customer_id as string) ?? before.customer_id,
    sale_at: (changes.sale_at as string) ?? new Date(before.sale_at).toISOString(),
    quantity: (changes.quantity as string) ?? before.quantity,
    currency: ((changes.currency as string) ?? before.currency) as SaleInput['currency'],
    price_per_litre: (changes.price_per_litre as string) ?? (keepPrice ? before.price_per_litre : undefined),
    payment_method: (changes.payment_method as SaleInput['payment_method']) ?? before.payment_method ?? undefined,
    amount_paid: changes.amount_paid as string | undefined,
    payment_id: changes.payment_id as string | undefined,
    notes: (changes.notes as string | null | undefined) ?? before.notes,
  };
  const corrected = await insertSale(client, owner, next, id);
  if (next.customer_id !== before.customer_id || next.currency !== before.currency) await allocate(client, owner, before.customer_id, before.currency);
  const keys = ['customer_id', 'quantity', 'price_per_litre', 'currency', 'total', 'sale_at', 'payment_method'] as const;
  await audit(client, {
    ownerId: owner,
    actorUserId: actor,
    action: 'milk_sale.corrected',
    entityTable: 'milk_sales',
    entityId: id,
    reason: why,
    before: Object.fromEntries(keys.map((k) => [k, before[k]])),
    after: { ...Object.fromEntries(keys.map((k) => [k, corrected[k]])), corrected_sale_id: corrected.id },
  });
  return corrected;
}

/** A sale with what has been paid towards it (from completed payments). */
export async function saleStatus(client: Queryable, owner: string, id: string) {
  const { rows } = await client.query<{ paid: string; due: string }>(
    `select coalesce(sum(a.amount), 0)::text as paid, (s.total - coalesce(sum(a.amount), 0))::text as due
     from public.milk_sales s
     left join public.payment_allocations a on a.sale_id = s.id and exists (select 1 from public.payments p where p.id = a.payment_id and p.status = 'completed')
     where s.owner_id = $1 and s.id = $2 group by s.total`,
    [owner, id],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const EXPENSE_COLUMNS = `id, expense_date::text, category, amount::text, currency, payee, payment_method, payment_status, receipt_path, notes,
  status, void_reason, version, created_at, updated_at`;

const expenseFields = {
  expense_date: pastDate,
  category: z.enum(['feed', 'veterinary_care', 'medicines', 'transport', 'equipment', 'utilities', 'labour', 'other']),
  amount: money,
  currency: z.enum(CURRENCIES),
  payee: text(120),
  payment_method: z.enum(METHODS).nullable().optional(),
  payment_status: z.enum(['paid', 'unpaid', 'partially_paid']).optional(),
  notes: text(1000),
};
export const ExpenseCreate = z.object({ id: z.uuid(), ...expenseFields }).strict();
export const ExpenseUpdate = z.object(expenseFields).partial().strict();

export async function getExpense(client: Queryable, owner: string, id: string, forUpdate = false) {
  const { rows } = await client.query(`select ${EXPENSE_COLUMNS} from public.farm_expenses where owner_id = $1 and id = $2 ${forUpdate ? 'for update' : ''}`, [owner, id]);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Expense not found.');
  return rows[0];
}

export async function createExpense(client: DbClient, owner: string, actor: string, input: z.infer<typeof ExpenseCreate>) {
  const { rows: clash } = await client.query('select 1 from public.farm_expenses where id = $1', [input.id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');
  const keys = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined && k !== 'id');
  const { rows } = await client.query(
    `insert into public.farm_expenses (owner_id, id${keys.map((k) => `, ${k}`).join('')}) values ($1, $2${keys.map((_, i) => `, $${i + 3}`).join('')})
     returning ${EXPENSE_COLUMNS}`,
    [owner, input.id, ...keys.map((k) => input[k as keyof typeof input])],
  );
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'expense.created', entityTable: 'farm_expenses', entityId: input.id, after: rows[0] });
  return rows[0];
}

/** Corrections keep history: every changed field is audited with its old value. */
export async function updateExpense(client: DbClient, owner: string, actor: string, id: string, version: number, patch: z.infer<typeof ExpenseUpdate> & { receipt_path?: string }) {
  const before = await getExpense(client, owner, id, true);
  if (before.version !== version) throw new HttpError(409, 'version_conflict', 'This expense was changed elsewhere. Review the latest version.', { current: before });
  if (before.status === 'voided') throw new HttpError(409, 'voided', 'This expense was voided.');
  const changed = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined && String(patch[k as keyof typeof patch]) !== String(before[k]));
  if (!changed.length) return before;
  const { rows } = await client.query(
    `update public.farm_expenses set ${changed.map((k, i) => `${k} = $${i + 3}`).join(', ')} where owner_id = $1 and id = $2 returning ${EXPENSE_COLUMNS}`,
    [owner, id, ...changed.map((k) => patch[k as keyof typeof patch])],
  );
  await audit(client, {
    ownerId: owner,
    actorUserId: actor,
    action: 'expense.corrected',
    entityTable: 'farm_expenses',
    entityId: id,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, rows[0][k]])),
  });
  return rows[0];
}

export async function voidExpense(client: DbClient, owner: string, actor: string, id: string, version: number, why: string) {
  const before = await getExpense(client, owner, id, true);
  if (before.version !== version) throw new HttpError(409, 'version_conflict', 'This expense was changed elsewhere.', { current: before });
  if (before.status === 'voided') throw new HttpError(409, 'voided', 'This expense was already voided.');
  const { rows } = await client.query(
    `update public.farm_expenses set status = 'voided', void_reason = $3 where owner_id = $1 and id = $2 returning ${EXPENSE_COLUMNS}`,
    [owner, id, why],
  );
  await audit(client, { ownerId: owner, actorUserId: actor, action: 'expense.voided', entityTable: 'farm_expenses', entityId: id, reason: why, before });
  return rows[0];
}

