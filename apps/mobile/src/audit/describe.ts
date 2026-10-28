// Turns the account's audit log into plain sentences for the farmer: who or what it is about (by name),
// what changed (in words, with units and the farmer's date format) and why. Pure, so it can be tested.

import { PRODUCTION_LABELS, REPRODUCTIVE_LABELS, STATUS_LABELS } from '../animals/model';
import { CARE_FORMS, type FieldDef } from '../care/forms';
import { type CareData, CARE_KINDS, kindOfEntity } from '../care/model';
import { money, toCents } from '../finance/calc';
import { CATEGORY_LABELS, CUSTOMER_TYPES, METHOD_LABELS, MOVEMENT_LABELS } from '../finance/model';
import { formatDate, formatDateTime } from '../lib/dates';
import { L, SESSION_LABELS } from '../production/format';
import type { IconName } from '../ui/kit';

export interface AuditEntry {
  id: number;
  action: string;
  entity_table: string | null;
  entity_id: string | null;
  reason: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  occurred_at: string;
}

export type AuditGroup = 'milk' | 'animals' | 'money' | 'settings';

export interface Described {
  icon: IconName;
  title: string;
  lines: string[];
  reason: string | null;
  href: string | null;
  /** A change worth reviewing (correction, void, removal, price, adjustment, export…), not just a new record. */
  important: boolean;
  group: AuditGroup;
}

export interface DescribeContext {
  animalName: (id: string) => string | null;
  customerName: (id: string) => string | null;
  breedName: (id: string) => string | null;
  /** The animal a milk entry or care record belongs to, from the records on this phone. */
  milkCattle: (id: string) => string | null;
  careCattle: (table: string, id: string) => string | null;
  care: CareData;
  currency: string;
  dateFormat?: string;
}

type Row = Record<string, unknown>;
type Fmt = (v: unknown, row: Row) => string;

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const GROUP: Record<string, AuditGroup> = {
  milk_production: 'milk',
  milk_stock_movements: 'milk',
  cattle: 'animals',
  cattle_breeds: 'animals',
  milk_sales: 'money',
  payments: 'money',
  milk_prices: 'money',
  farm_expenses: 'money',
  customers: 'money',
  farmer_accounts: 'settings',
  exports: 'settings',
};

const REPORT_TITLES: Record<string, string> = {
  herd: 'Herd',
  production: 'Milk production',
  health: 'Health',
  reproduction: 'Breeding and calving',
  vaccination: 'Vaccination',
  finance: 'Sales, money and stock',
};

const PAYMENT_STATUS: Record<string, string> = { paid: 'Paid', unpaid: 'Not paid yet', partially_paid: 'Partly paid' };
const PREF_LABELS: Record<string, string> = {
  vaccinations: 'Vaccination reminders',
  breeding: 'Pregnancy check and calving reminders',
  health: 'Health follow-up and falling milk reminders',
  withdrawal: 'Milk withdrawal reminders',
  finance: 'Unpaid balance and stock reminders',
  sync_problems: 'Sync problem notifications',
};

/** Says how one field changed, as a sentence. */
function change(label: string, before: unknown, after: unknown, fmt: (v: unknown) => string): string {
  const a = str(before) === null ? null : fmt(before);
  const b = str(after) === null ? null : fmt(after);
  if (a === null && b !== null) return `${label} set to ${b}`;
  if (a !== null && b === null) return `${label} removed`;
  return `${label} changed from ${a} to ${b}`;
}

/** Describes every field present in `after` (the server stores only what changed), using labels and formats. */
function changes(before: Row | null, after: Row | null, fields: Record<string, [string, Fmt?]>): string[] {
  const keys = Object.keys({ ...(before ?? {}), ...(after ?? {}) }).filter((k) => k in fields);
  return keys.map((k) => {
    const [label, fmt] = fields[k];
    return change(label, before?.[k], after?.[k], (v) => (fmt ? fmt(v, { ...(before ?? {}), ...(after ?? {}) }) : String(v)));
  });
}

export function describe(e: AuditEntry, ctx: DescribeContext): Described | null {
  const before = e.before_data;
  const after = e.after_data;
  // Before and after together: a void stores the full record before and only the new status after.
  const row: Row = { ...(before ?? {}), ...(after ?? {}) };
  const id = e.entity_id ?? '';
  const [area, verb] = [e.action.slice(0, e.action.lastIndexOf('.')), e.action.slice(e.action.lastIndexOf('.') + 1)];
  const table = e.entity_table ?? '';
  const date = (v: unknown) => (String(v).length > 10 ? formatDateTime(String(v), ctx.dateFormat) : formatDate(String(v), ctx.dateFormat));
  const animal = (cid: unknown) => (str(cid) ? (ctx.animalName(String(cid)) ?? 'An animal no longer on this phone') : 'An animal');
  const customer = (cid: unknown) => (str(cid) ? (ctx.customerName(String(cid)) ?? 'a customer') : 'a customer');
  const cur = (r: Row) => String(r.currency ?? ctx.currency);
  const amount = (v: unknown, r: Row) => money(toCents(String(v)), cur(r));
  const bool = (v: unknown) => (v === true || v === 'true' ? 'Yes' : 'No');
  const base = { reason: e.reason, group: GROUP[table] ?? (kindOfEntity(table) ? 'animals' : 'settings'), lines: [] as string[] } as const;

  // ---- Animals --------------------------------------------------------------------------------
  if (area === 'cattle') {
    const name = str(row.ear_tag) || str(row.name) ? [row.ear_tag, row.name].filter(Boolean).join(' · ') : animal(id);
    const who = ctx.animalName(id) ?? name;
    const href = verb === 'deleted' ? null : `/animal/${id}`;
    const fields: Record<string, [string, Fmt?]> = {
      ear_tag: ['Ear tag'],
      name: ['Name'],
      breed_id: ['Breed', (v) => ctx.breedName(String(v)) ?? 'a breed'],
      sex: ['Sex', (v) => (v === 'female' ? 'Female' : 'Male')],
      birth_date: ['Birth date', date],
      birth_date_estimated: ['Birth date estimated', bool],
      acquisition_date: ['Acquired on', date],
      acquisition_source: ['Acquired from'],
      purchase_price: ['Purchase price'],
      purchase_currency: ['Purchase currency'],
      weight_kg: ['Weight', (v) => `${v} kg`],
      dam_id: ['Mother', (v) => animal(v)],
      sire_id: ['Father', (v) => animal(v)],
      sire_identifier: ['Father (bull or semen)'],
      reproductive_status: ['Breeding status', (v) => REPRODUCTIVE_LABELS[v as keyof typeof REPRODUCTIVE_LABELS] ?? String(v)],
      production_status: ['Milk status', (v) => PRODUCTION_LABELS[v as keyof typeof PRODUCTION_LABELS] ?? String(v)],
      notes: ['Notes'],
    };
    if (verb === 'created') return { ...base, icon: 'cow', title: `${who} registered`, href, important: false };
    if (verb === 'updated') return { ...base, icon: 'pencil-outline', title: `${who}: details changed`, lines: changes(before, after, fields), href, important: true };
    if (verb === 'photo_changed') return { ...base, icon: 'camera-outline', title: `${who}: photo changed`, href, important: false };
    if (verb === 'deleted') return { ...base, icon: 'delete-outline', title: `${name} deleted (entered by mistake)`, href, important: true };
    if (verb === 'status_changed') {
      const s = String(after?.status ?? '');
      const title = s === 'active' ? `${who} is active again` : `${who} marked as ${lower(STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s)}${after?.status_date ? ` on ${date(after.status_date)}` : ''}`;
      return { ...base, icon: 'swap-horizontal', title, lines: str(after?.status_details) ? [String(after!.status_details)] : [], href, important: true };
    }
    if (verb === 'reproductive_status_derived') {
      const s = String(after?.reproductive_status ?? '');
      return {
        ...base,
        icon: 'heart-pulse',
        title: `${who}: now ${lower(REPRODUCTIVE_LABELS[s as keyof typeof REPRODUCTIVE_LABELS] ?? s)}`,
        reason: null,
        lines: ['Worked out from breeding, pregnancy check or calving records'],
        href,
        important: false,
      };
    }
  }

  if (area === 'breed') {
    const name = String(after?.name ?? before?.name ?? 'Breed');
    if (verb === 'created') return { ...base, group: 'animals', icon: 'cow', title: `Breed added: ${name}`, href: '/breeds', important: false };
    const lines: string[] = [];
    if (before?.name !== after?.name) lines.push(`Renamed from ${before?.name} to ${after?.name}`);
    if (before?.active !== after?.active) lines.push(after?.active ? 'Shown again when registering animals' : 'Hidden when registering animals');
    return { ...base, group: 'animals', icon: 'pencil-outline', title: `Breed ${name} changed`, lines, href: '/breeds', important: true };
  }

  // ---- Milk -----------------------------------------------------------------------------------
  if (area === 'milk_production') {
    const cow = animal(row.cattle_id ?? ctx.milkCattle(id));
    const href = `/milk/${id}`;
    if (verb === 'created') {
      const session = SESSION_LABELS[row.session as keyof typeof SESSION_LABELS] ?? '';
      return { ...base, icon: 'water-outline', title: `${cow}: ${lower(session)} milk ${date(row.production_date)}, ${L(Math.round(Number(row.quantity) * 100))}`, href, important: false };
    }
    if (verb === 'corrected') {
      const lines = changes(before, after, {
        cattle_id: ['Animal', (v) => animal(v)],
        production_date: ['Date', date],
        session: ['Session', (v) => SESSION_LABELS[v as keyof typeof SESSION_LABELS] ?? String(v)],
        quantity: ['Milk', (v) => L(Math.round(Number(v) * 100))],
        notes: ['Note'],
        restricted: ['Under withdrawal', bool],
      });
      return { ...base, icon: 'pencil-outline', title: `${cow}: milk entry corrected`, lines, href, important: true };
    }
    if (verb === 'voided') {
      return { ...base, icon: 'close-circle-outline', title: `${cow}: milk entry voided${before?.quantity ? ` (${L(Math.round(Number(before.quantity) * 100))})` : ''}`, lines: ['No longer counted in totals or stock'], href, important: true };
    }
    if (verb === 'restriction_changed') {
      const on = after?.restricted === true;
      return {
        ...base,
        icon: on ? 'water-off-outline' : 'water-check-outline',
        title: on ? `${cow}: milk entry now under withdrawal` : `${cow}: milk entry no longer under withdrawal`,
        lines: [on ? 'Taken out of the milk for sale' : 'Added back to the milk for sale'],
        href,
        important: true,
      };
    }
  }

  if (area === 'stock') {
    const qty = String(row.quantity ?? '');
    const litres = `${qty.replace('-', '')} L`;
    const day = row.movement_date ? date(row.movement_date) : null;
    if (verb === 'reversed') {
      return { ...base, icon: 'undo', title: 'Stock record reversed (entered by mistake)', lines: [`${qty.startsWith('-') ? '−' : '+'}${litres}${day ? ` on ${day}` : ''}`], href: '/stock', important: true };
    }
    const use = verb in MOVEMENT_LABELS && !['adjustment', 'opening_balance'].includes(verb);
    if (use) {
      return { ...base, icon: 'cup-outline', title: `Milk ${lower(MOVEMENT_LABELS[verb as keyof typeof MOVEMENT_LABELS])}: ${litres}`, lines: day ? [day] : [], href: '/stock', important: false };
    }
    if (verb === 'opening_balance') return { ...base, icon: 'flag-outline', title: `Opening stock set: ${litres}`, lines: day ? [day] : [], href: '/stock', important: true };
    return { ...base, icon: 'plus-minus-variant', title: `Stock adjusted: ${qty.startsWith('-') ? 'removed' : 'added'} ${litres}`, lines: day ? [day] : [], href: '/stock', important: true };
  }

  // ---- Animal care ----------------------------------------------------------------------------
  const kind = kindOfEntity(table);
  if (kind && ['created', 'updated', 'removed'].includes(verb)) {
    const config = CARE_FORMS[kind];
    const label = CARE_KINDS[kind].label;
    const cattle = row.cattle_id ?? row.dam_id ?? ctx.careCattle(table, id);
    const who = kind === 'schedule' ? null : animal(cattle);
    const href = `/care/${kind}/${id}`;
    const fieldFmt = (f: FieldDef): Fmt => (v) => {
      if (f.type === 'date') return date(v);
      if (f.type === 'datetime') return date(v);
      if (f.type === 'bool') return bool(v);
      if (f.type === 'choice') return f.options?.find((o) => o.value === v)?.label ?? String(v);
      if (f.type === 'animal') return animal(v);
      if (f.type === 'link') return 'a linked record';
      if (f.type === 'ints') return Array.isArray(v) ? v.join(', ') : String(v);
      return String(v);
    };
    const fields = Object.fromEntries(config.fields.map((f) => [f.key, [f.label, fieldFmt(f)] as [string, Fmt]]));
    const summary = (r: Row | null) => {
      try {
        return r ? config.summary(r, { care: ctx.care }) : null;
      } catch {
        return null;
      }
    };
    const subject = who ? `${who}: ${lower(label)}` : label;
    if (verb === 'created') return { ...base, group: 'animals', icon: 'clipboard-plus-outline', title: `${subject} recorded`, lines: [summary(after)].filter(Boolean) as string[], href, important: false };
    if (verb === 'updated') return { ...base, group: 'animals', icon: 'pencil-outline', title: `${subject} changed`, lines: changes(before, after, fields), href, important: true };
    return { ...base, group: 'animals', icon: 'delete-outline', title: `${subject} removed`, lines: [summary(before)].filter(Boolean) as string[], href: null, important: true };
  }

  // ---- Customers and money --------------------------------------------------------------------
  if (area === 'customer') {
    const name = str(row.name) ?? customer(id);
    const fields: Record<string, [string, Fmt?]> = {
      name: ['Name'],
      phone: ['Phone'],
      address: ['Address'],
      customer_type: ['Type', (v) => CUSTOMER_TYPES[v as keyof typeof CUSTOMER_TYPES] ?? String(v)],
      registered_on: ['Customer since', date],
      notes: ['Notes'],
      active: ['Active customer', bool],
    };
    if (verb === 'created') return { ...base, icon: 'account-plus-outline', title: `New customer: ${name}`, href: `/customers/${id}`, important: false };
    return { ...base, icon: 'pencil-outline', title: `${ctx.customerName(id) ?? name}: details changed`, lines: changes(before, after, fields), href: `/customers/${id}`, important: true };
  }

  if (area === 'milk_sale') {
    const who = customer(row.customer_id);
    const href = `/sale/${id}`;
    if (verb === 'created') {
      return { ...base, icon: 'cash', title: `Sale to ${who}: ${row.quantity} L, ${amount(row.total, row)}`, lines: [`${METHOD_LABELS[row.payment_method as keyof typeof METHOD_LABELS] ?? ''}`].filter(Boolean), href, important: false };
    }
    if (verb === 'voided') return { ...base, icon: 'close-circle-outline', title: `Sale to ${who} voided (${amount(row.total, row)})`, href, important: true };
    if (verb === 'corrected') {
      const both = { ...(before ?? {}), ...(after ?? {}) };
      const lines = changes(before, after, {
        customer_id: ['Customer', (v) => customer(v)],
        quantity: ['Litres', (v) => `${v} L`],
        price_per_litre: ['Price per litre', (v) => amount(v, both)],
        currency: ['Currency'],
        total: ['Total', (v) => amount(v, both)],
        sale_at: ['Sold at', date],
        payment_method: ['Paid by', (v) => METHOD_LABELS[v as keyof typeof METHOD_LABELS] ?? String(v)],
      }).filter((l) => !l.startsWith('Sold at changed') || before?.sale_at !== after?.sale_at);
      const corrected = str(after?.corrected_sale_id);
      return { ...base, icon: 'pencil-outline', title: `Sale to ${customer(before?.customer_id)} corrected`, lines: [...lines, 'The original is kept as voided'], href: corrected ? `/sale/${corrected}` : href, important: true };
    }
  }

  if (area === 'payment') {
    const who = customer(row.customer_id);
    const href = `/payment/${id}`;
    const method = METHOD_LABELS[row.method as keyof typeof METHOD_LABELS];
    if (verb === 'payment') return { ...base, icon: 'cash-plus', title: `Payment from ${who}: ${amount(row.amount, row)}`, lines: method ? [method] : [], href, important: false };
    if (verb === 'refund') return { ...base, icon: 'cash-refund', title: `Refund to ${who}: ${amount(row.amount, row)}`, href, important: true };
    if (verb === 'adjustment') return { ...base, icon: 'tag-outline', title: `Discount or write-off for ${who}: ${amount(row.amount, row)}`, href, important: true };
    if (verb === 'voided') return { ...base, icon: 'close-circle-outline', title: `Payment from ${who} voided (${amount(row.amount, row)})`, href, important: true };
  }

  if (area === 'milk_price') {
    return { ...base, icon: 'tag-outline', title: `Milk price set to ${amount(row.price_per_litre, row)} per litre`, lines: row.effective_from ? [`From ${date(row.effective_from)}`] : [], href: '/prices', important: true };
  }

  if (area === 'expense') {
    const category = CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS];
    const href = `/expenses/${id}`;
    if (verb === 'created') return { ...base, icon: 'receipt', title: `Expense: ${category ?? 'other'}, ${amount(row.amount, row)}`, lines: str(row.payee) ? [`Paid to ${row.payee}`] : [], href, important: false };
    if (verb === 'voided') return { ...base, icon: 'close-circle-outline', title: `${category ?? 'An'} expense voided (${amount(row.amount, row)})`, href, important: true };
    const both = { ...(before ?? {}), ...(after ?? {}) };
    const lines = changes(before, after, {
      expense_date: ['Date', date],
      category: ['Category', (v) => CATEGORY_LABELS[v as keyof typeof CATEGORY_LABELS] ?? String(v)],
      amount: ['Amount', (v) => amount(v, both)],
      currency: ['Currency'],
      payee: ['Paid to'],
      payment_method: ['Paid by', (v) => METHOD_LABELS[v as keyof typeof METHOD_LABELS] ?? String(v)],
      payment_status: ['Payment', (v) => PAYMENT_STATUS[String(v)] ?? String(v)],
      notes: ['Note'],
      receipt_path: ['Receipt photo', () => 'added'],
    }).map((l) => (l.startsWith('Receipt photo') ? 'Receipt photo added' : l));
    return { ...base, icon: 'pencil-outline', title: 'Expense corrected', lines, href, important: true };
  }

  // ---- Account and exports --------------------------------------------------------------------
  if (area === 'export') {
    const report = REPORT_TITLES[String(row.report)] ?? String(row.report ?? 'A report');
    return { ...base, group: 'settings', icon: 'file-export-outline', title: `${report} report exported as ${verb.toUpperCase()}`, reason: null, lines: row.row_count !== undefined ? [`${row.row_count} rows`] : [], href: '/reports', important: true };
  }

  if (area === 'account') {
    if (verb === 'created') return { ...base, icon: 'account-check-outline', title: 'Account created', href: null, important: false };
    if (verb === 'deletion_requested') return { ...base, icon: 'account-remove-outline', title: 'Account deletion requested', href: null, important: true };
    if (verb === 'settings_updated') {
      const lines: string[] = [];
      for (const k of Object.keys(after ?? {})) {
        const a = after?.[k];
        const b = before?.[k];
        if (k === 'onboarding_step') continue;
        if (k === 'onboarding_completed_at') lines.push('Finished setting up the app');
        else if (k === 'notification_prefs' && a && typeof a === 'object') {
          const next = a as Row;
          const prev = (b ?? {}) as Row;
          for (const p of Object.keys(next)) {
            if (prev[p] === next[p]) continue;
            if (p === 'reminder_time') lines.push(`Reminder time changed to ${next[p]}`);
            else if (PREF_LABELS[p]) lines.push(`${PREF_LABELS[p]} turned ${next[p] ? 'on' : 'off'}`);
          }
        } else if (k === 'decline_rule' && a && typeof a === 'object') {
          const r = a as Row;
          lines.push(`Falling milk alert: last ${r.recent_days} days against the ${r.baseline_days} before, at ${r.threshold_pct}% down`);
        } else if (k === 'breeding_intervals' && a && typeof a === 'object') {
          const r = a as Row;
          lines.push(`Pregnancy check after ${r.pregnancy_check_days} days, gestation ${r.gestation_days} days`);
        } else {
          const labels: Record<string, string> = {
            display_name: 'Your name',
            preferred_contact: 'Preferred contact',
            phone: 'Phone',
            farm_name: 'Farm name',
            farm_location: 'Farm location',
            time_zone: 'Time zone',
            currency: 'Currency',
            language: 'Language',
            date_format: 'Date format',
          };
          if (labels[k]) lines.push(change(labels[k], b, a, String));
        }
      }
      if (!lines.length) return null; // e.g. only the onboarding step moved on: not worth showing
      return { ...base, icon: 'cog-outline', title: 'Settings changed', lines, href: '/settings', important: true };
    }
  }

  // Anything new the server starts recording still shows, in readable words.
  const words = e.action.replace(/[._]/g, ' ');
  return { ...base, icon: 'history', title: words.charAt(0).toUpperCase() + words.slice(1), href: null, important: !e.action.endsWith('created') };
}
