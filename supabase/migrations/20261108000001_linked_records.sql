-- Records that belong together: a calving and the pregnancy check before it (and so the mating),
-- an action on a milk alert and the health concern it led to, and an expense and the care record it paid for.

alter table public.calving_records
  add column pregnancy_check_id uuid references public.pregnancy_checks(id);

alter table public.alert_actions
  add column health_record_id uuid references public.animal_health_records(id);

-- The care record an expense was for (a vet visit, a treatment, an insemination…), named by the app's
-- record kind. Both or neither.
alter table public.farm_expenses
  add column care_kind text check (care_kind in ('health', 'vet-visit', 'treatment', 'breeding', 'pregnancy-check', 'calving', 'vaccination')),
  add column care_id uuid,
  add constraint farm_expenses_care_link check ((care_kind is null) = (care_id is null));
create index farm_expenses_care_idx on public.farm_expenses (care_id) where care_id is not null;

-- Existing calvings: the latest confirmed pregnancy of that cow before the calving, within a year,
-- not already taken by another calving.
update public.calving_records c
   set pregnancy_check_id = (
     select p.id from public.pregnancy_checks p
      where p.owner_id = c.owner_id and p.cattle_id = c.dam_id and p.deleted_at is null and p.result = 'pregnant'
        and p.examined_on <= c.calved_on and p.examined_on > c.calved_on - 365
      order by p.examined_on desc limit 1)
 where c.pregnancy_check_id is null and c.deleted_at is null;

-- Herd health trends: why an animal left the herd (cause of death, reason for sale) and the illness that
-- led to a death; and a condition category on each health concern, so cases can be counted by kind.
-- The farmer records what they or the vet found; the app never diagnoses.
alter table public.cattle
  add column status_reason text check (status_reason in (
    'illness', 'calving', 'injury', 'poisoning', 'predator_theft', 'old_age', 'unknown',   -- deaths
    'low_yield', 'infertility', 'surplus', 'needed_money',                                 -- sales
    'other')),
  add column status_health_record_id uuid references public.animal_health_records(id);

alter table public.animal_health_records
  add column condition text check (condition in (
    'mastitis', 'lameness', 'tick_borne', 'diarrhoea', 'respiratory', 'fertility', 'metabolic', 'injury', 'other'));
