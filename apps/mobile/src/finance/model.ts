// Mirrors the finance rows returned by the API (apps/api/src/finance.ts, stock.ts).

export type Method = 'cash' | 'mobile_money' | 'bank_transfer' | 'card' | 'credit' | 'other';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  customer_type: 'individual' | 'business' | 'school' | 'cooperative' | 'other';
  registered_on: string;
  notes: string | null;
  active: boolean;
  version: number;
}

export interface Price {
  id: string;
  currency: string;
  price_per_litre: string;
  effective_from: string;
  reason: string | null;
}

export interface Sale {
  id: string;
  customer_id: string;
  sale_at: string;
  quantity: string;
  price_per_litre: string;
  currency: string;
  total: string;
  price_id: string | null;
  price_source: 'list' | 'override';
  payment_method: Method | null;
  notes: string | null;
  status: 'completed' | 'voided';
  void_reason: string | null;
  voided_at: string | null;
  corrects_sale_id: string | null;
  /** Local only, until the server's payment arrives: money taken with an unsynced sale, and the id that payment will have. */
  local_amount_paid?: string;
  local_payment_id?: string;
}

export interface Payment {
  id: string;
  customer_id: string;
  kind: 'payment' | 'refund' | 'adjustment';
  amount: string;
  currency: string;
  method: Method;
  paid_at: string;
  reference: string | null;
  notes: string | null;
  reason: string | null;
  status: 'completed' | 'voided';
  void_reason: string | null;
}

export interface Allocation {
  id: string;
  payment_id: string;
  sale_id: string;
  amount: string;
}

export type MovementKind =
  | 'opening_balance'
  | 'production'
  | 'sale'
  | 'farm_consumption'
  | 'calf_feeding'
  | 'spoilage'
  | 'gift'
  | 'other_use'
  | 'adjustment'
  | 'reversal';

export interface Movement {
  id: string;
  movement_date: string;
  kind: MovementKind;
  quantity: string; // signed
  reason: string | null;
  milk_production_id: string | null;
  sale_id: string | null;
  reverses_id: string | null;
}

export interface Expense {
  id: string;
  expense_date: string;
  category: 'feed' | 'veterinary_care' | 'medicines' | 'transport' | 'equipment' | 'utilities' | 'labour' | 'other';
  amount: string;
  currency: string;
  payee: string | null;
  payment_method: Method | null;
  payment_status: 'paid' | 'unpaid' | 'partially_paid';
  receipt_path: string | null;
  notes: string | null;
  status: 'active' | 'voided';
  void_reason: string | null;
  version: number;
  local_receipt_uri?: string;
}

export const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  credit: 'On credit',
  other: 'Other',
};

export const USE_LABELS = {
  farm_consumption: 'Used at home',
  calf_feeding: 'Fed to calves',
  spoilage: 'Spoiled or discarded',
  gift: 'Given away',
  other_use: 'Other use',
} as const;

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  ...USE_LABELS,
  opening_balance: 'Opening balance',
  production: 'Production',
  sale: 'Sale',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

export const CATEGORY_LABELS: Record<Expense['category'], string> = {
  feed: 'Feed',
  veterinary_care: 'Veterinary care',
  medicines: 'Medicines',
  transport: 'Transport',
  equipment: 'Equipment',
  utilities: 'Utilities',
  labour: 'Labour',
  other: 'Other',
};

export const CUSTOMER_TYPES = { individual: 'Individual', business: 'Business', school: 'School', cooperative: 'Cooperative', other: 'Other' } as const;
