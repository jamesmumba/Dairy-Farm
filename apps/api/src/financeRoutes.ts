import { randomUUID } from 'node:crypto';
import type { Router } from './router.js';
import { z } from 'zod';
import { audit, type Db } from './db.js';
import {
  balances,
  correctSale,
  createCustomer,
  createExpense,
  createPayment,
  createPrice,
  createSale,
  CUSTOMER_COLUMNS,
  CustomerCreate,
  CustomerUpdate,
  EXPENSE_COLUMNS,
  ExpenseCreate,
  ExpenseUpdate,
  getCustomer,
  getExpense,
  PAYMENT_COLUMNS,
  PaymentCreate,
  PRICE_COLUMNS,
  PriceCreate,
  SALE_COLUMNS,
  SaleCorrect,
  SaleCreate,
  saleStatus,
  updateCustomer,
  updateExpense,
  voidExpense,
  VoidBody,
  voidPayment,
  voidSale,
} from './finance.js';
import { HttpError, parse, requireIdempotencyKey, requireVersion, send } from './http.js';
import { idempotent } from './idempotency.js';
import type { Photos } from './photos.js';
import { available, createMovement, MovementCreate, MovementReverse, reverseMovement } from './stock.js';
import { pastDate } from './validation.js';

const IdParam = z.object({ id: z.uuid() });
const URL_SECONDS = 600;

export function financeRoutes(v1: Router, { db, receipts }: { db: Db; receipts: Photos }) {
  const who = (req: { farmer: { account: { id: string }; authUserId: string } }) => ({ owner: req.farmer.account.id, actor: req.farmer.authUserId });
  const id = (params: unknown) => parse(IdParam, params).id;

  /** A write with an idempotency key, run in one transaction. */
  const write =
    (operation: (req: any) => string, status: number, run: (c: any, owner: string, actor: string, req: any) => Promise<unknown>, body: (req: any) => unknown = (req) => req.body) =>
    async (req: any, reply: any) => {
      const { owner, actor } = who(req);
      const key = requireIdempotencyKey(req);
      const input = body(req);
      return send(reply, await idempotent(db, owner, key, operation(req), input, async (c) => ({ status, body: await run(c, owner, actor, req) })));
    };

  // --- Customers --------------------------------------------------------------
  v1.get('/customers', async (req) => (await db.query(`select ${CUSTOMER_COLUMNS} from public.customers where owner_id = $1 order by lower(name)`, [who(req).owner])).rows);
  v1.post('/customers', write(() => 'customer.create', 201, (c, o, a, req) => createCustomer(c, o, a, parse(CustomerCreate, req.body))));
  v1.patch('/customers/:id', write((req) => `customer.update:${id(req.params)}`, 200, (c, o, a, req) => updateCustomer(c, o, a, id(req.params), requireVersion(req), parse(CustomerUpdate, req.body))));

  /** Statement: balances per currency, each sale with paid/due, and payments. */
  v1.get('/customers/:id/statement', async (req) => {
    const { owner } = who(req);
    const customerId = id(req.params);
    const customer = await getCustomer(db, owner, customerId);
    const sales = (await db.query(`select ${SALE_COLUMNS} from public.milk_sales where owner_id = $1 and customer_id = $2 order by sale_at desc`, [owner, customerId])).rows;
    const withStatus = await Promise.all(sales.map(async (s) => ({ ...s, ...(s.status === 'completed' ? await saleStatus(db, owner, s.id) : { paid: '0.00', due: '0.00' }) })));
    const payments = (await db.query(`select ${PAYMENT_COLUMNS} from public.payments where owner_id = $1 and customer_id = $2 order by paid_at desc`, [owner, customerId])).rows;
    return { customer, balances: await balances(db, owner, customerId), sales: withStatus, payments, generated_at: new Date().toISOString() };
  });

  // --- Prices -----------------------------------------------------------------
  v1.get('/milk-prices', async (req) => (await db.query(`select ${PRICE_COLUMNS} from public.milk_prices where owner_id = $1 order by effective_from desc`, [who(req).owner])).rows);
  v1.post('/milk-prices', write(() => 'milk_price.create', 201, (c, o, a, req) => createPrice(c, o, a, parse(PriceCreate, req.body))));

  // --- Sales ------------------------------------------------------------------
  v1.get('/milk-sales', async (req) => {
    const q = parse(z.object({ customer_id: z.uuid().optional() }).strict(), req.query);
    return (
      await db.query(`select ${SALE_COLUMNS} from public.milk_sales where owner_id = $1 and ($2::uuid is null or customer_id = $2) order by sale_at desc`, [
        who(req).owner,
        q.customer_id ?? null,
      ])
    ).rows;
  });
  v1.post('/milk-sales', write(() => 'milk_sale.create', 201, (c, o, a, req) => createSale(c, o, a, parse(SaleCreate, req.body))));
  v1.post('/milk-sales/:id/void', write((req) => `milk_sale.void:${id(req.params)}`, 200, (c, o, a, req) => voidSale(c, o, a, id(req.params), parse(VoidBody, req.body).reason)));
  v1.post('/milk-sales/:id/correct', write((req) => `milk_sale.correct:${id(req.params)}`, 201, (c, o, a, req) => correctSale(c, o, a, id(req.params), parse(SaleCorrect, req.body))));

  // --- Payments ---------------------------------------------------------------
  v1.get('/payments', async (req) => (await db.query(`select ${PAYMENT_COLUMNS} from public.payments where owner_id = $1 order by paid_at desc`, [who(req).owner])).rows);
  v1.post('/payments', write(() => 'payment.create', 201, (c, o, a, req) => createPayment(c, o, a, parse(PaymentCreate, req.body))));
  v1.post('/payments/:id/void', write((req) => `payment.void:${id(req.params)}`, 200, (c, o, a, req) => voidPayment(c, o, a, id(req.params), parse(VoidBody, req.body).reason)));

  // --- Stock ------------------------------------------------------------------
  v1.get('/stock/available', async (req) => {
    const { date } = parse(z.object({ date: pastDate }).strict(), req.query);
    return { date, available: await available(db, who(req).owner, date) };
  });
  v1.post('/stock/movements', write(() => 'stock.create', 201, (c, o, a, req) => createMovement(c, o, a, parse(MovementCreate, req.body))));
  v1.post('/stock/movements/:id/reverse', write((req) => `stock.reverse:${id(req.params)}`, 201, (c, o, a, req) => reverseMovement(c, o, a, id(req.params), parse(MovementReverse, req.body))));

  // --- Expenses ---------------------------------------------------------------
  v1.get('/expenses', async (req) => (await db.query(`select ${EXPENSE_COLUMNS} from public.farm_expenses where owner_id = $1 order by expense_date desc`, [who(req).owner])).rows);
  v1.post('/expenses', write(() => 'expense.create', 201, (c, o, a, req) => createExpense(c, o, a, parse(ExpenseCreate, req.body))));
  v1.patch('/expenses/:id', write((req) => `expense.update:${id(req.params)}`, 200, (c, o, a, req) => updateExpense(c, o, a, id(req.params), requireVersion(req), parse(ExpenseUpdate, req.body))));
  v1.post('/expenses/:id/void', write((req) => `expense.void:${id(req.params)}`, 200, (c, o, a, req) => voidExpense(c, o, a, id(req.params), requireVersion(req), parse(VoidBody, req.body).reason)));

  v1.post('/expenses/:id/receipt-upload', async (req) => {
    const { owner } = who(req);
    const expenseId = id(req.params);
    await getExpense(db, owner, expenseId);
    const path = `${owner}/${expenseId}/${randomUUID()}.jpg`;
    return { path, upload_url: await receipts.createUploadUrl(path) };
  });
  v1.post(
    '/expenses/:id/receipt',
    write((req) => `expense.receipt:${id(req.params)}`, 200, async (c, o, a, req) => {
      const expenseId = id(req.params);
      const { path } = parse(z.object({ path: z.string().min(1).max(300) }).strict(), req.body);
      await getExpense(c, o, expenseId); // another owner's expense: 404 before anything else
      if (!path.startsWith(`${o}/${expenseId}/`) || path.includes('..')) throw new HttpError(400, 'validation_failed', 'Invalid receipt path.', { field: 'path' });
      if (!(await receipts.exists(path))) throw new HttpError(400, 'photo_missing', 'The receipt upload did not finish. Try again.');
      const current = await getExpense(c, o, expenseId, true);
      return updateExpense(c, o, a, expenseId, current.version, { receipt_path: path });
    }),
  );
  v1.get('/expenses/:id/receipt-url', async (req) => {
    const e = await getExpense(db, who(req).owner, id(req.params));
    if (!e.receipt_path) throw new HttpError(404, 'no_receipt', 'This expense has no receipt photo.');
    return { url: await receipts.createDownloadUrl(e.receipt_path, URL_SECONDS), expires_in: URL_SECONDS };
  });

  // --- Export log -------------------------------------------------------------
  // Reports are built on the phone; every CSV/PDF export is recorded here (spec: exports are audited).
  v1.post(
    '/exports',
    write(() => 'export.log', 201, async (c, o, a, req) => {
      const e = parse(
        z
          .object({
            id: z.uuid(),
            report: z.string().trim().min(1).max(60),
            format: z.enum(['csv', 'pdf']),
            filters: z.record(z.string(), z.string().max(200)).default({}),
            row_count: z.number().int().min(0).max(1_000_000),
            generated_at: z.iso.datetime({ offset: true }),
          })
          .strict(),
        req.body,
      );
      await audit(c, { ownerId: o, actorUserId: a, action: `export.${e.format}`, entityTable: 'exports', entityId: e.id, reason: e.report, after: e });
      return e;
    }),
  );

  // --- Audit history ----------------------------------------------------------
  v1.get('/audit', async (req) => {
    const q = parse(
      z
        .object({
          entity_table: z.string().max(60).optional(),
          entity_id: z.uuid().optional(),
          before_id: z.coerce.number().int().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        })
        .strict(),
      req.query,
    );
    const { rows } = await db.query(
      `select a.id, a.action, a.entity_table, a.entity_id, a.reason, a.before_data, a.after_data, a.occurred_at, d.name as device_name
       from public.audit_logs a left join public.devices d on d.owner_id = a.owner_id and d.device_id = a.device_id
       where a.owner_id = $1 and ($2::text is null or a.entity_table = $2) and ($3::uuid is null or a.entity_id = $3) and ($4::bigint is null or a.id < $4)
       order by a.id desc limit ${q.limit}`,
      [who(req).owner, q.entity_table ?? null, q.entity_id ?? null, q.before_id ?? null],
    );
    return rows;
  });
}
