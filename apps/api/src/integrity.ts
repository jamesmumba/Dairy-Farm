import type { Queryable } from './db.js';

// Cross-table rules the schema's constraints cannot express. Each query returns the rows
// that break the rule; an empty result means the rule holds. Run with `npm run integrity`.

export interface Check {
  name: string;
  severity: 'error' | 'warning';
  sql: string;
}

export const CHECKS: Check[] = [
  {
    name: 'Milk entry stock equals its saleable litres',
    severity: 'error',
    sql: `select p.owner_id, p.id, p.quantity::text, p.status, p.restricted, coalesce(sum(m.quantity), 0)::text as in_stock
          from public.milk_production p
          left join public.milk_stock_movements m on m.milk_production_id = p.id
          group by p.id
          having coalesce(sum(m.quantity), 0) <> case when p.status = 'valid' and not p.restricted then p.quantity else 0 end`,
  },
  {
    name: 'Completed sale has one unreversed stock movement of its quantity',
    severity: 'error',
    sql: `select s.owner_id, s.id, s.quantity::text, s.status,
                 coalesce(sum(m.quantity) filter (where m.kind = 'sale'), 0)::text as sold,
                 coalesce(sum(r.quantity), 0)::text as reversed
          from public.milk_sales s
          left join public.milk_stock_movements m on m.sale_id = s.id
          left join public.milk_stock_movements r on r.reverses_id = m.id
          group by s.id
          having (s.status = 'completed' and (coalesce(sum(m.quantity) filter (where m.kind = 'sale'), 0) <> -s.quantity or coalesce(sum(r.quantity), 0) <> 0))
              or (s.status = 'voided' and coalesce(sum(m.quantity) filter (where m.kind = 'sale'), 0) + coalesce(sum(r.quantity), 0) <> 0)`,
  },
  {
    name: 'Payment allocations do not exceed the payment',
    severity: 'error',
    sql: `select p.owner_id, p.id, p.amount::text, sum(a.amount)::text as allocated
          from public.payments p join public.payment_allocations a on a.payment_id = p.id
          join public.milk_sales s on s.id = a.sale_id and s.status = 'completed'
          where p.status = 'completed'
          group by p.id having sum(a.amount) > p.amount`,
  },
  {
    name: 'Allocations to a sale do not exceed its total',
    severity: 'error',
    sql: `select s.owner_id, s.id, s.total::text, sum(a.amount)::text as paid
          from public.milk_sales s join public.payment_allocations a on a.sale_id = s.id
          join public.payments p on p.id = a.payment_id and p.status = 'completed'
          where s.status = 'completed'
          group by s.id having sum(a.amount) > s.total`,
  },
  {
    name: 'Records belong to the same farmer as the animal or customer they reference',
    severity: 'error',
    sql: `select x.owner_id, x.id, x.t from (
            select owner_id, id, 'milk_production' t, cattle_id ref from public.milk_production
            union all select owner_id, id, 'treatments', cattle_id from public.treatments
            union all select owner_id, id, 'animal_health_records', cattle_id from public.animal_health_records
            union all select owner_id, id, 'vaccination_records', cattle_id from public.vaccination_records
            union all select owner_id, id, 'breeding_records', cattle_id from public.breeding_records
            union all select owner_id, id, 'pregnancy_checks', cattle_id from public.pregnancy_checks
          ) x join public.cattle c on c.id = x.ref where c.owner_id <> x.owner_id
          union all
          select s.owner_id, s.id, 'milk_sales' from public.milk_sales s join public.customers c on c.id = s.customer_id where c.owner_id <> s.owner_id
          union all
          select p.owner_id, p.id, 'payments' from public.payments p join public.customers c on c.id = p.customer_id where c.owner_id <> p.owner_id`,
  },
  {
    name: 'No day ends with negative milk stock (investigate; never auto-corrected)',
    severity: 'warning',
    sql: `select owner_id, d::text as day, closing::text from (
            select owner_id, movement_date d, sum(sum(quantity)) over (partition by owner_id order by movement_date) closing
            from public.milk_stock_movements group by owner_id, movement_date
          ) x where closing < 0`,
  },
];

export async function runIntegrityChecks(db: Queryable) {
  const results = [];
  for (const check of CHECKS) {
    const { rows } = await db.query(check.sql);
    results.push({ name: check.name, severity: check.severity, problems: rows });
  }
  return results;
}
