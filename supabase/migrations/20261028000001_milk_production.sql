-- Stage 4: milk production.

-- The farmer's "meaningful decline" rule: a cow's average daily yield over the last
-- `recent_days` (ending yesterday) is at least `threshold_pct` below her average over the
-- `baseline_days` before that. Each period needs `min_days` days with records.
alter table public.farmer_accounts
  add column decline_rule jsonb not null
  default '{"recent_days": 7, "baseline_days": 7, "threshold_pct": 20, "min_days": 4}'::jsonb;

-- Sanity bound per session; a typo like 120 instead of 12.0 is rejected, not stored.
alter table public.milk_production add constraint milk_production_quantity_max check (quantity <= 100);

-- One production stock movement per entry at most (reversals reference it instead).
create unique index milk_stock_production_uq on public.milk_stock_movements (milk_production_id)
  where kind = 'production';
