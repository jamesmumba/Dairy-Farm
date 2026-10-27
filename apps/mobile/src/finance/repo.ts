import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { MilkEntry } from '../production/repo';
import { syncSoon } from '../sync/engine';
import { deleteUnsynced, listRecords, putPending, saveLocal, type Stored } from '../sync/store';
import { fromCents, type PendingStock, saleTotal } from './calc';
import type { Allocation, Customer, Expense, Movement, Payment, Price, Sale } from './model';

// Saved on the phone first, then queued. The server re-checks prices, totals, stock and
// limits, and is authoritative: a change it rejects goes to Sync issues.

const data = <T>(entity: string) => listRecords<T>(entity).map((r) => r.data);

export function loadFinance() {
  return {
    customers: data<Customer>('customers').sort((a, b) => a.name.localeCompare(b.name)),
    prices: data<Price>('milk_prices'),
    sales: data<Sale>('milk_sales'),
    payments: data<Payment>('payments'),
    allocations: data<Allocation>('payment_allocations'),
    movements: data<Movement>('milk_stock_movements'),
    expenses: data<Expense>('farm_expenses'),
  };
}
export type FinanceData = ReturnType<typeof loadFinance>;

/** Unsynced sales and milk entries, for the phone's stock estimate. */
export function pendingStock(): PendingStock {
  return {
    sales: listRecords<Sale>('milk_sales').filter((r) => r.sync_state !== 'synced').map((r) => r.data),
    production: listRecords<MilkEntry>('milk_production')
      .filter((r) => r.data.version === 0 && r.data.status === 'valid' && !r.data.restricted)
      .map((r) => r.data),
  };
}

// --- Customers ---------------------------------------------------------------------

export function addCustomer(fields: Omit<Customer, 'id' | 'version' | 'active' | 'registered_on'> & { registered_on?: string }): string {
  const id = randomUUID();
  const body = { id, ...fields };
  saveLocal('customers', id, { ...body, active: true, registered_on: fields.registered_on ?? new Date().toISOString().slice(0, 10), version: 0 }, {
    kind: 'create',
    method: 'POST',
    path: '/v1/customers',
    body,
  });
  syncSoon();
  return id;
}

export function editCustomer(current: Stored<Customer>, changes: Partial<Customer>) {
  saveLocal('customers', current.data.id, { ...current.data, ...changes }, {
    kind: 'update',
    method: 'PATCH',
    path: `/v1/customers/${current.data.id}`,
    body: changes,
    ifMatch: current.data.version,
  });
  syncSoon();
}

// --- Prices ---------------------------------------------------------------------------

export function setPrice(currency: string, price: string, effectiveFrom: string, reason: string | null) {
  const id = randomUUID();
  const body = { id, currency, price_per_litre: price, effective_from: effectiveFrom, reason };
  saveLocal('milk_prices', id, body, { kind: 'create', method: 'POST', path: '/v1/milk-prices', body });
  syncSoon();
}

// --- Sales --------------------------------------------------------------------------------

export interface SaleInput {
  customer_id: string;
  sale_at: string;
  quantity: string;
  currency: string;
  price_per_litre: string;
  override: boolean; // false: the listed price, which the server looks up itself
  amount_paid: string;
  payment_method: Payment['method'] | null;
  notes: string | null;
}

export function recordSale(input: SaleInput): string {
  const id = randomUUID();
  const paymentId = randomUUID();
  const paid = Number(input.amount_paid) > 0;
  const body = {
    id,
    customer_id: input.customer_id,
    sale_at: input.sale_at,
    quantity: input.quantity,
    currency: input.currency,
    ...(input.override && { price_per_litre: input.price_per_litre }),
    ...(paid && { amount_paid: input.amount_paid, payment_id: paymentId }),
    ...(input.payment_method && { payment_method: input.payment_method }),
    notes: input.notes,
  };
  const sale: Sale = {
    id,
    customer_id: input.customer_id,
    sale_at: input.sale_at,
    quantity: input.quantity,
    price_per_litre: input.price_per_litre,
    currency: input.currency,
    total: fromCents(saleTotal(input.quantity, input.price_per_litre)),
    price_id: null,
    price_source: input.override ? 'override' : 'list',
    payment_method: input.payment_method,
    notes: input.notes,
    status: 'completed',
    void_reason: null,
    voided_at: null,
    corrects_sale_id: null,
    ...(paid && { local_amount_paid: input.amount_paid, local_payment_id: paymentId }),
  };
  saveLocal('milk_sales', id, sale, { kind: 'create', method: 'POST', path: '/v1/milk-sales', body });
  syncSoon();
  return id;
}

export function voidSale(current: Stored<Sale>, reason: string) {
  if (deleteUnsynced('milk_sales', current.data.id)) return;
  saveLocal('milk_sales', current.data.id, { ...current.data, status: 'voided', void_reason: reason }, {
    kind: 'void',
    method: 'POST',
    path: `/v1/milk-sales/${current.data.id}/void`,
    body: { reason },
  });
  syncSoon();
}

/** The original is voided and a corrected sale linked to it; the server keeps both. */
export function correctSale(current: Stored<Sale>, changes: { quantity?: string; price_per_litre?: string }, reason: string): string {
  // A correction is a server-side void + new linked sale; a sale the server has not seen
  // yet is simply voided (removed) and recorded again instead.
  if (current.sync_state !== 'synced') throw new Error('This sale has not synced yet. Void it and record it again instead.');
  const newId = randomUUID();
  const original = current.data;
  const corrected: Sale = {
    ...original,
    ...changes,
    id: newId,
    total: fromCents(saleTotal(changes.quantity ?? original.quantity, changes.price_per_litre ?? original.price_per_litre)),
    price_source: changes.price_per_litre ? 'override' : original.price_source,
    corrects_sale_id: original.id,
    local_amount_paid: undefined,
    local_payment_id: undefined,
  };
  saveLocal('milk_sales', original.id, { ...original, status: 'voided', void_reason: `Corrected: ${reason}` }, {
    kind: 'correct',
    method: 'POST',
    path: `/v1/milk-sales/${original.id}/correct`,
    body: { new_id: newId, ...changes, reason },
  });
  // Shown at once; the correction op creates it on the server, whose copy then replaces this.
  putPending('milk_sales', newId, corrected);
  syncSoon();
  return newId;
}

// --- Payments ------------------------------------------------------------------------------

export function recordPayment(fields: Omit<Payment, 'id' | 'status' | 'void_reason'>): string {
  const id = randomUUID();
  const body = { id, ...fields };
  saveLocal('payments', id, { ...body, status: 'completed', void_reason: null }, { kind: 'create', method: 'POST', path: '/v1/payments', body });
  syncSoon();
  return id;
}

export function voidPayment(current: Stored<Payment>, reason: string) {
  if (deleteUnsynced('payments', current.data.id)) return;
  saveLocal('payments', current.data.id, { ...current.data, status: 'voided', void_reason: reason }, {
    kind: 'void',
    method: 'POST',
    path: `/v1/payments/${current.data.id}/void`,
    body: { reason },
  });
  syncSoon();
}

// --- Stock -----------------------------------------------------------------------------------

export function recordMovement(input: { kind: string; quantity: string; direction?: 'add' | 'remove'; movement_date: string; reason: string | null }) {
  const id = randomUUID();
  const outgoing = !['opening_balance'].includes(input.kind) && !(input.kind === 'adjustment' && input.direction === 'add');
  const movement: Movement = {
    id,
    movement_date: input.movement_date,
    kind: input.kind as Movement['kind'],
    quantity: outgoing ? `-${input.quantity}` : input.quantity,
    reason: input.reason,
    milk_production_id: null,
    sale_id: null,
    reverses_id: null,
  };
  saveLocal('milk_stock_movements', id, movement, {
    kind: 'create',
    method: 'POST',
    path: '/v1/stock/movements',
    body: { id, kind: input.kind, quantity: input.quantity, movement_date: input.movement_date, ...(input.direction && { direction: input.direction }), ...(input.reason && { reason: input.reason }) },
  });
  syncSoon();
}

export function reverseMovement(target: Movement, reason: string) {
  const id = randomUUID();
  const reversal: Movement = {
    id,
    movement_date: target.movement_date,
    kind: 'reversal',
    quantity: target.quantity.startsWith('-') ? target.quantity.slice(1) : `-${target.quantity}`,
    reason,
    milk_production_id: null,
    sale_id: null,
    reverses_id: target.id,
  };
  saveLocal('milk_stock_movements', id, reversal, { kind: 'create', method: 'POST', path: `/v1/stock/movements/${target.id}/reverse`, body: { id, reason } });
  syncSoon();
}

// --- Expenses ----------------------------------------------------------------------------------

type ExpenseFields = Omit<Expense, 'id' | 'status' | 'void_reason' | 'version' | 'receipt_path' | 'local_receipt_uri'>;

export function addExpense(fields: ExpenseFields): string {
  const id = randomUUID();
  const body = { id, ...fields };
  saveLocal('farm_expenses', id, { ...body, status: 'active', void_reason: null, receipt_path: null, version: 0 }, { kind: 'create', method: 'POST', path: '/v1/expenses', body });
  syncSoon();
  return id;
}

export function editExpense(current: Stored<Expense>, changes: Partial<ExpenseFields>) {
  saveLocal('farm_expenses', current.data.id, { ...current.data, ...changes }, {
    kind: 'update',
    method: 'PATCH',
    path: `/v1/expenses/${current.data.id}`,
    body: changes,
    ifMatch: current.data.version,
  });
  syncSoon();
}

export function voidExpense(current: Stored<Expense>, reason: string) {
  if (deleteUnsynced('farm_expenses', current.data.id)) return;
  saveLocal('farm_expenses', current.data.id, { ...current.data, status: 'voided', void_reason: reason }, {
    kind: 'void',
    method: 'POST',
    path: `/v1/expenses/${current.data.id}/void`,
    body: { reason },
    ifMatch: current.data.version,
  });
  syncSoon();
}

/** Shrinks the receipt photo and queues it like an animal photo (separate private bucket). */
export async function setReceiptPhoto(current: Stored<Expense>, sourceUri: string) {
  const image = await ImageManipulator.manipulate(sourceUri).resize({ width: 1600 }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  const dir = new Directory(Paths.document, 'receipts');
  if (!dir.exists) dir.create();
  const file = new File(dir, `${current.data.id}-${randomUUID()}.jpg`);
  new File(saved.uri).moveSync(file);
  saveLocal('farm_expenses', current.data.id, { ...current.data, local_receipt_uri: file.uri }, {
    kind: 'photo',
    method: 'POST',
    path: `/v1/expenses/${current.data.id}/receipt`,
    body: { local_uri: file.uri, upload_path: `/v1/expenses/${current.data.id}/receipt-upload`, confirm_path: `/v1/expenses/${current.data.id}/receipt` },
  });
  syncSoon();
}

