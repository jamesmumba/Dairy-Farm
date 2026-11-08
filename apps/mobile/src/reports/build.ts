// Reports built from the records on this phone. Pure functions: every report has a
// period, filters, generation time, units/currency, definitions, and says what is missing.

import { ageInMonths, type Breed, type Cattle, DEATH_CAUSE_LABELS, displayName, PRODUCTION_LABELS, REPRODUCTIVE_LABELS, SALE_REASON_LABELS, STATUS_LABELS } from '../animals/model';
import { storyOf, withdrawalCovering } from '../care/related';
import { activeWithdrawal, CALVING_OUTCOME_LABELS, type CareData, CONDITION_LABELS, EVENT_LABELS, RECOVERY_LABELS, RESULT_LABELS, SEVERITY_LABELS, underTreatment } from '../care/model';
import { balances, money, reconcile, saleDue, summarize as summarizeMoney, toCents } from '../finance/calc';
import { CATEGORY_LABELS, METHOD_LABELS, type Method, PAYMENT_KIND_LABELS } from '../finance/model';
import type { FinanceData } from '../finance/repo';
import { formatDate, formatDateTime } from '../lib/dates';
import { addDays, dailyTotals, decline, type DeclineRule, highLow, litres, type MilkRow, perAnimal, perBreed, previousRange, summarize } from '../production/calc';

export type ReportId = 'herd' | 'production' | 'health' | 'herd-health' | 'reproduction' | 'vaccination' | 'finance';

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface Table {
  title: string;
  columns: Column[];
  rows: Record<string, string>[];
  empty?: string;
  /** One row per day, oldest first: on screen only the latest days are shown until asked. */
  daily?: boolean;
}

export interface Report {
  id: ReportId;
  title: string;
  period: { from: string; to: string } | null;
  filters: Record<string, string>; // human-readable, e.g. { Animal: 'ZM-001 · Daisy' }
  generatedAt: string;
  units: string;
  summary: { label: string; value: string; note?: string }[];
  tables: Table[];
  definitions: string[];
  missing: string[];
}

export interface Filters {
  from: string;
  to: string;
  cattleId?: string | null;
  breedId?: string | null;
  customerId?: string | null;
  method?: Method | null;
  paid?: 'paid' | 'unpaid' | null;
  category?: string | null;
  currency: string;
}

export interface ReportInput {
  animals: Cattle[];
  breeds: Breed[];
  milk: MilkRow[];
  care: CareData;
  finance: FinanceData;
  declineRule: DeclineRule;
  today: string;
  now: string;
  farmDate: (iso: string) => string;
}

const L = (cl: number) => `${litres(cl)} L`;
const inRange = (d: string | null | undefined, f: Filters) => !!d && d >= f.from && d <= f.to;
const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

function context(input: ReportInput, f: Filters) {
  const name = new Map(input.animals.map((a) => [a.id, displayName(a)]));
  const breedName = new Map(input.breeds.map((b) => [b.id, b.name]));
  const animal = (id: string | null | undefined) => (id ? (name.get(id) ?? 'Unknown animal') : '');
  const scopeAnimals = input.animals.filter((a) => (!f.cattleId || a.id === f.cattleId) && (!f.breedId || a.breed_id === f.breedId));
  const inScope = new Set(scopeAnimals.map((a) => a.id));
  const filters: Record<string, string> = {};
  if (f.cattleId) filters.Animal = animal(f.cattleId);
  if (f.breedId) filters.Breed = breedName.get(f.breedId) ?? '';
  return { animal, breedName, scopeAnimals, inScope, filters };
}

function base(id: ReportId, title: string, input: ReportInput, f: Filters | null, filters: Record<string, string>, units: string): Omit<Report, 'summary' | 'tables' | 'definitions' | 'missing'> {
  return { id, title, period: f ? { from: f.from, to: f.to } : null, filters, generatedAt: input.now, units };
}

// --- Herd -----------------------------------------------------------------------------

export function herdReport(input: ReportInput, f: Filters): Report {
  const { breedName, scopeAnimals, filters } = context(input, f);
  const active = scopeAnimals.filter((a) => a.status === 'active');
  const count = (pred: (a: Cattle) => boolean) => String(scopeAnimals.filter(pred).length);
  const breeds = [...new Set(active.map((a) => a.breed_id ?? ''))];
  const left = scopeAnimals.filter((a) => a.status !== 'active' && inRange(a.status_date, f));
  return {
    ...base('herd', 'Herd', input, f, filters, 'animals'),
    summary: [
      { label: 'Animals recorded', value: String(scopeAnimals.length) },
      { label: 'Active (on the farm)', value: String(active.length) },
      { label: 'Cows in milk', value: String(active.filter((a) => a.production_status === 'lactating').length) },
      { label: 'Confirmed pregnancies', value: String(active.filter((a) => a.reproductive_status === 'pregnant').length), note: 'From pregnancy checks only' },
      { label: 'Sold / transferred / deceased', value: `${count((a) => a.status === 'sold')} / ${count((a) => a.status === 'transferred')} / ${count((a) => a.status === 'deceased')}` },
    ],
    tables: [
      {
        title: 'Active animals by breed',
        columns: [
          { key: 'breed', label: 'Breed' },
          { key: 'female', label: 'Female', numeric: true },
          { key: 'male', label: 'Male', numeric: true },
          { key: 'milking', label: 'In milk', numeric: true },
          { key: 'total', label: 'Total', numeric: true },
        ],
        rows: breeds.map((b) => {
          const of = active.filter((a) => (a.breed_id ?? '') === b);
          return {
            breed: b ? (breedName.get(b) ?? 'Unknown') : 'Breed not set',
            female: String(of.filter((a) => a.sex === 'female').length),
            male: String(of.filter((a) => a.sex === 'male').length),
            milking: String(of.filter((a) => a.production_status === 'lactating').length),
            total: String(of.length),
          };
        }),
        empty: 'No active animals.',
      },
      {
        title: 'Left the farm in this period',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'animal', label: 'Animal' },
          { key: 'status', label: 'Status' },
          { key: 'details', label: 'Details' },
        ],
        rows: left.map((a) => ({ date: formatDate(a.status_date), animal: displayName(a), status: STATUS_LABELS[a.status], details: a.status_details ?? '' })),
        empty: 'None.',
      },
      {
        title: 'Active animals',
        columns: [
          { key: 'animal', label: 'Animal' },
          { key: 'breed', label: 'Breed' },
          { key: 'sex', label: 'Sex' },
          { key: 'production', label: 'Production' },
          { key: 'reproduction', label: 'Reproduction' },
        ],
        rows: active.map((a) => ({
          animal: displayName(a),
          breed: breedName.get(a.breed_id ?? '') ?? '',
          sex: a.sex === 'female' ? 'Female' : 'Male',
          production: PRODUCTION_LABELS[a.production_status],
          reproduction: a.sex === 'female' ? REPRODUCTIVE_LABELS[a.reproductive_status] : '',
        })),
      },
    ],
    definitions: ['Active: animals still on the farm.', 'Confirmed pregnancy: the latest pregnancy check result is “pregnant”. Breeding alone never counts.'],
    missing: [
      ...(active.some((a) => !a.breed_id) ? [`${active.filter((a) => !a.breed_id).length} active animal(s) have no breed recorded.`] : []),
      ...(active.some((a) => !a.birth_date) ? [`${active.filter((a) => !a.birth_date).length} active animal(s) have no birth date or age.`] : []),
    ],
  };
}

// --- Production ---------------------------------------------------------------------

export function productionReport(input: ReportInput, f: Filters): Report {
  const { animal, breedName, inScope, filters } = context(input, f);
  const milk = input.milk.filter((m) => inScope.has(m.cattle_id));
  const s = summarize(milk, f.from, f.to);
  const prevRange = previousRange({ from: f.from, to: f.to });
  const prev = summarize(milk, prevRange.from, prevRange.to);
  const change = prev.totalCl ? Math.round(((s.totalCl - prev.totalCl) / prev.totalCl) * 100) : null;
  const yields = perAnimal(milk, f.from, f.to);
  const longest = Math.max(1, ...yields.map((y) => y.days));
  const { high, low } = highLow(yields, Math.min(input.declineRule.min_days, longest));
  const breedOf = new Map(input.animals.map((a) => [a.id, a.breed_id]));
  const days = dailyTotals(milk, f.from, f.to);
  const declines = input.animals
    .filter((a) => inScope.has(a.id) && a.status === 'active' && a.sex === 'female')
    .map((a) => ({ a, d: decline(milk, a.id, input.today, input.declineRule) }))
    .filter(({ d }) => d.state === 'decline');
  return {
    ...base('production', 'Milk production', input, f, filters, 'litres (L)'),
    summary: [
      { label: 'Milk produced', value: L(s.totalCl), note: change === null ? 'No records in the previous period' : `${change >= 0 ? '+' : ''}${change}% vs ${formatDate(prevRange.from)}–${formatDate(prevRange.to)}` },
      { label: 'Not for sale (withdrawal)', value: L(s.restrictedCl) },
      { label: 'Average per producing cow per day', value: s.avgPerCowDayCl === null ? '—' : L(s.avgPerCowDayCl) },
      { label: 'Cows milked', value: String(s.cows) },
    ],
    tables: [
      {
        title: 'Daily totals',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'litres', label: 'Litres', numeric: true },
        ],
        rows: days.map((d) => ({ date: formatDate(d.date), litres: d.recorded ? litres(d.cl) : 'no records' })),
        daily: true,
      },
      {
        title: 'By cow',
        columns: [
          { key: 'cow', label: 'Cow' },
          { key: 'breed', label: 'Breed' },
          { key: 'days', label: 'Days', numeric: true },
          { key: 'total', label: 'Total L', numeric: true },
          { key: 'avg', label: 'L per day', numeric: true },
        ],
        rows: yields.map((y) => ({ cow: animal(y.cattle_id), breed: breedName.get(breedOf.get(y.cattle_id) ?? '') ?? '', days: String(y.days), total: litres(y.totalCl), avg: litres(y.avgCl) })),
        empty: 'No milk recorded.',
      },
      {
        title: 'By breed',
        columns: [
          { key: 'breed', label: 'Breed' },
          { key: 'cows', label: 'Cows', numeric: true },
          { key: 'total', label: 'Total L', numeric: true },
          { key: 'avg', label: 'L per cow per day', numeric: true },
        ],
        rows: perBreed(milk, (id) => breedOf.get(id) ?? null, f.from, f.to).map((b) => ({
          breed: b.breed_id ? (breedName.get(b.breed_id) ?? 'Unknown') : 'Breed not set',
          cows: String(b.cows),
          total: litres(b.totalCl),
          avg: litres(b.avgPerCowDayCl),
        })),
      },
      {
        title: 'Highest and lowest producers',
        columns: [
          { key: 'rank', label: '' },
          { key: 'cow', label: 'Cow' },
          { key: 'avg', label: 'L per day', numeric: true },
        ],
        rows: [...high.map((y) => ({ rank: 'High', cow: animal(y.cattle_id), avg: litres(y.avgCl) })), ...low.map((y) => ({ rank: 'Low', cow: animal(y.cattle_id), avg: litres(y.avgCl) }))],
        empty: 'Not enough records to rank.',
      },
      {
        title: 'Production decline flags',
        columns: [
          { key: 'cow', label: 'Cow' },
          { key: 'recent', label: 'Recent L/day', numeric: true },
          { key: 'before', label: 'Before L/day', numeric: true },
          { key: 'change', label: 'Change', numeric: true },
        ],
        rows: declines.map(({ a, d }) =>
          d.state === 'decline' ? { cow: displayName(a), recent: litres(d.recentAvgCl), before: litres(d.baselineAvgCl), change: `${d.changePct}%` } : { cow: '', recent: '', before: '', change: '' },
        ),
        empty: 'No cows flagged.',
      },
    ],
    definitions: [
      'Daily yield: the sum of a cow’s valid sessions that day. Voided entries are never counted.',
      'Average per producing cow per day: total ÷ (cow, day) pairs with records. Days without records are not counted as zero.',
      `Decline: the last ${input.declineRule.recent_days} days up to yesterday vs the ${input.declineRule.baseline_days} days before, flagged at −${input.declineRule.threshold_pct}% or more, needing ${input.declineRule.min_days}+ days with records in each.`,
      'Withdrawal milk is produced but not saleable; it is shown separately.',
    ],
    missing: days.some((d) => !d.recorded) ? [`${days.filter((d) => !d.recorded).length} day(s) in the period have no milk records.`] : [],
  };
}

// --- Health ---------------------------------------------------------------------------

export function healthReport(input: ReportInput, f: Filters): Report {
  const { animal, inScope, filters } = context(input, f);
  const health = live(input.care.health).filter((h) => inScope.has(h.cattle_id));
  const treatments = live(input.care.treatments).filter((t) => inScope.has(t.cattle_id));
  const now = new Date(input.now);
  const activeIds = input.animals.filter((a) => inScope.has(a.id) && a.status === 'active').map((a) => a.id);
  const treating = activeIds.filter((id) => underTreatment(treatments, id, input.today));
  const withdrawn = activeIds.map((id) => ({ id, t: activeWithdrawal(treatments, id, now) })).filter((x) => x.t);
  const incidents = health.filter((h) => inRange(h.reported_on, f));
  const outcomes = (Object.keys(RECOVERY_LABELS) as (keyof typeof RECOVERY_LABELS)[]).map((s) => ({ status: RECOVERY_LABELS[s], n: incidents.filter((h) => h.recovery_status === s).length }));
  return {
    ...base('health', 'Animal health', input, f, filters, 'records'),
    summary: [
      { label: 'Under treatment now', value: String(treating.length) },
      { label: 'Milk withdrawal now', value: String(withdrawn.length) },
      { label: 'Health concerns in period', value: String(incidents.length), note: `${incidents.filter((h) => h.condition_status === 'confirmed').length} confirmed by a vet` },
      { label: 'Follow-ups due or overdue', value: String(health.filter((h) => h.follow_up_on && h.follow_up_on <= input.today && !['recovered', 'died'].includes(h.recovery_status)).length) },
    ],
    tables: [
      {
        title: 'Milk withdrawal in force',
        columns: [
          { key: 'animal', label: 'Animal' },
          { key: 'medicine', label: 'Medicine' },
          { key: 'until', label: 'Until' },
        ],
        rows: withdrawn.map(({ id, t }) => ({ animal: animal(id), medicine: t!.medication, until: formatDateTime(t!.withdrawal_ends_at!) })),
        empty: 'None.',
      },
      {
        title: 'Health concerns in this period',
        columns: [
          { key: 'date', label: 'Reported' },
          { key: 'animal', label: 'Animal' },
          { key: 'issue', label: 'Problem' },
          { key: 'status', label: 'Diagnosis' },
          { key: 'severity', label: 'Severity' },
          { key: 'recovery', label: 'Outcome' },
        ],
        rows: incidents.map((h) => ({
          date: formatDate(h.reported_on),
          animal: animal(h.cattle_id),
          issue: h.confirmed_diagnosis ?? h.suspected_issue ?? '',
          status: h.condition_status === 'confirmed' ? 'Confirmed' : h.condition_status === 'ruled_out' ? 'Ruled out' : 'Suspected',
          severity: h.severity ? SEVERITY_LABELS[h.severity] : '',
          recovery: RECOVERY_LABELS[h.recovery_status],
        })),
        empty: 'No health concerns recorded.',
      },
      {
        title: 'Treatments in this period',
        columns: [
          { key: 'date', label: 'Started' },
          { key: 'animal', label: 'Animal' },
          { key: 'medicine', label: 'Medicine' },
          { key: 'completed', label: 'Completed' },
          { key: 'withdrawal', label: 'Withdrawal until' },
        ],
        rows: treatments
          .filter((t) => inRange(t.started_on, f))
          .map((t) => ({
            date: formatDate(t.started_on),
            animal: animal(t.cattle_id),
            medicine: t.medication,
            completed: t.completed_on ? formatDate(t.completed_on) : 'ongoing',
            withdrawal: t.requires_milk_withdrawal && t.withdrawal_ends_at ? formatDateTime(t.withdrawal_ends_at) : '',
          })),
        empty: 'None.',
      },
      {
        title: 'Outcomes of concerns in this period',
        columns: [
          { key: 'status', label: 'Outcome' },
          { key: 'n', label: 'Count', numeric: true },
        ],
        rows: outcomes.map((o) => ({ status: o.status, n: String(o.n) })),
      },
    ],
    definitions: ['Under treatment: a treatment has started and is not completed.', 'Withdrawal in force: the vet’s withdrawal end time has not been reached, even if the treatment is complete.', 'The app records what the vet or farmer reports; it does not diagnose.'],
    missing: incidents.some((h) => h.condition_status === 'suspected') ? [`${incidents.filter((h) => h.condition_status === 'suspected').length} concern(s) have no confirmed diagnosis.`] : [],
  };
}

// --- Reproduction ---------------------------------------------------------------------

export function reproductionReport(input: ReportInput, f: Filters): Report {
  const { animal, inScope, filters } = context(input, f);
  const breeding = live(input.care.breeding).filter((b) => inScope.has(b.cattle_id));
  const checks = live(input.care.checks).filter((c) => inScope.has(c.cattle_id));
  const calvings = live(input.care.calvings).filter((c) => inScope.has(c.dam_id));
  const attempts = breeding.filter((b) => b.event_type !== 'heat_observed' && inRange(b.event_at.slice(0, 10), f));
  const examined = checks.filter((c) => c.result !== 'pending' && inRange(c.examined_on, f));
  const unsuccessful = examined.filter((c) => c.result === 'not_pregnant').length;
  const pregnant = input.animals.filter((a) => inScope.has(a.id) && a.status === 'active' && a.reproductive_status === 'pregnant');
  // Calving interval: days between consecutive recorded calvings of the same cow.
  const intervals = [...new Set(calvings.map((c) => c.dam_id))].flatMap((dam) => {
    const dates = calvings.filter((c) => c.dam_id === dam).map((c) => c.calved_on).sort();
    return dates.slice(1).map((d, i) => ({ dam, from: dates[i], to: d, days: Math.round((Date.parse(d) - Date.parse(dates[i])) / 86_400_000) }));
  });
  const expectedFor = (cattleId: string) =>
    checks
      .filter((c) => c.cattle_id === cattleId && c.result === 'pregnant' && c.expected_calving_on)
      .sort((a, b) => (b.examined_on ?? '').localeCompare(a.examined_on ?? ''))[0]?.expected_calving_on ?? null;
  return {
    ...base('reproduction', 'Reproduction', input, f, filters, 'records'),
    summary: [
      { label: 'Breeding attempts in period', value: String(attempts.length), note: 'Natural mating and insemination' },
      { label: 'Pregnancy checks done', value: String(examined.length), note: `${examined.filter((c) => c.result === 'pregnant').length} pregnant · ${unsuccessful} not pregnant` },
      { label: 'Confirmed pregnant now', value: String(pregnant.length) },
      { label: 'Calvings in period', value: String(calvings.filter((c) => inRange(c.calved_on, f)).length) },
    ],
    tables: [
      {
        title: 'Breeding and heat in this period',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'cow', label: 'Cow' },
          { key: 'event', label: 'Event' },
          { key: 'bull', label: 'Bull / semen' },
        ],
        rows: breeding.filter((b) => inRange(b.event_at.slice(0, 10), f)).map((b) => ({ date: formatDate(b.event_at.slice(0, 10)), cow: animal(b.cattle_id), event: EVENT_LABELS[b.event_type], bull: b.bull_or_semen_id ?? '' })),
        empty: 'None.',
      },
      {
        title: 'Pregnancy check results',
        columns: [
          { key: 'date', label: 'Examined' },
          { key: 'cow', label: 'Cow' },
          { key: 'result', label: 'Result' },
          { key: 'expected', label: 'Expected calving' },
        ],
        rows: examined.map((c) => ({ date: formatDate(c.examined_on), cow: animal(c.cattle_id), result: RESULT_LABELS[c.result], expected: formatDate(c.expected_calving_on) })),
        empty: 'None.',
      },
      {
        title: 'Confirmed pregnancies',
        columns: [
          { key: 'cow', label: 'Cow' },
          { key: 'expected', label: 'Expected calving' },
        ],
        rows: pregnant.map((a) => ({ cow: displayName(a), expected: formatDate(expectedFor(a.id)) })),
        empty: 'None.',
      },
      {
        title: 'Calvings in this period',
        columns: [
          { key: 'date', label: 'Calved' },
          { key: 'cow', label: 'Mother' },
          { key: 'outcome', label: 'Outcome' },
          { key: 'calf', label: 'Calf' },
        ],
        rows: calvings.filter((c) => inRange(c.calved_on, f)).map((c) => ({ date: formatDate(c.calved_on), cow: animal(c.dam_id), outcome: CALVING_OUTCOME_LABELS[c.outcome], calf: animal(c.calf_id) })),
        empty: 'None.',
      },
      {
        title: 'Calving intervals',
        columns: [
          { key: 'cow', label: 'Cow' },
          { key: 'from', label: 'From' },
          { key: 'to', label: 'To' },
          { key: 'days', label: 'Days', numeric: true },
        ],
        rows: intervals.map((i) => ({ cow: animal(i.dam), from: formatDate(i.from), to: formatDate(i.to), days: String(i.days) })),
        empty: 'Needs two recorded calvings of the same cow.',
      },
    ],
    definitions: [
      'A breeding attempt is a natural mating or insemination; heat observations are listed but not counted.',
      'Pregnant: only from a pregnancy check. Breeding alone never counts.',
      'Calving interval: days between two recorded calvings of the same cow, shown only when both are recorded.',
    ],
    missing: attempts.some((b) => !checks.some((c) => c.breeding_record_id === b.id && c.result !== 'pending'))
      ? [`${attempts.filter((b) => !checks.some((c) => c.breeding_record_id === b.id && c.result !== 'pending')).length} breeding attempt(s) have no pregnancy check result yet.`]
      : [],
  };
}

// --- Vaccination -------------------------------------------------------------------------

export function vaccinationReport(input: ReportInput, f: Filters): Report {
  const { animal, inScope, filters } = context(input, f);
  const doses = live(input.care.vaccinations).filter((v) => inScope.has(v.cattle_id));
  const active = input.animals.filter((a) => inScope.has(a.id) && a.status === 'active');
  const given = doses.filter((v) => v.status === 'completed' && inRange(v.administered_on, f));
  // Cancelled doses were never due; missed ones were, and count as not given.
  const dueInPeriod = doses.filter((v) => v.status !== 'cancelled' && v.due_on && inRange(v.due_on, f));
  const overdue = doses.filter((v) => v.status === 'scheduled' && v.due_on && v.due_on < input.today);
  const upcoming = doses.filter((v) => v.status === 'scheduled' && v.due_on && v.due_on >= input.today && v.due_on <= addDays(input.today, 30));
  const vaccines = [...new Set(doses.map((v) => v.vaccine_name))];
  const schedules = live(input.care.schedules);
  // Covered: a completed dose within the vaccine's interval (or 365 days when no interval is set).
  const coverage = vaccines.map((name) => {
    const interval = schedules.find((s) => s.vaccine_name === name)?.interval_days ?? 365;
    const since = addDays(input.today, -interval);
    const covered = active.filter((a) => doses.some((v) => v.cattle_id === a.id && v.vaccine_name === name && v.status === 'completed' && (v.administered_on ?? '') >= since));
    return { name, interval, covered: covered.length };
  });
  const completedOfDue = dueInPeriod.filter((v) => v.status === 'completed').length;
  return {
    ...base('vaccination', 'Vaccination', input, f, filters, 'doses'),
    summary: [
      { label: 'Doses given in period', value: String(given.length) },
      { label: 'Overdue now', value: String(overdue.length) },
      { label: 'Due in the next 30 days', value: String(upcoming.length) },
      {
        label: 'Compliance in period',
        value: dueInPeriod.length ? `${Math.round((completedOfDue / dueInPeriod.length) * 100)}%` : '—',
        note: `${completedOfDue} of ${dueInPeriod.length} doses due in the period were given`,
      },
    ],
    tables: [
      {
        title: 'Coverage by vaccine (active animals)',
        columns: [
          { key: 'vaccine', label: 'Vaccine' },
          { key: 'covered', label: 'Covered', numeric: true },
          { key: 'pct', label: '%', numeric: true },
        ],
        rows: coverage.map((c) => ({ vaccine: `${c.name} (within ${c.interval} days)`, covered: `${c.covered} of ${active.length}`, pct: active.length ? `${Math.round((c.covered / active.length) * 100)}%` : '—' })),
        empty: 'No vaccinations recorded.',
      },
      {
        title: 'Overdue',
        columns: [
          { key: 'due', label: 'Due' },
          { key: 'animal', label: 'Animal' },
          { key: 'vaccine', label: 'Vaccine' },
        ],
        rows: overdue.map((v) => ({ due: formatDate(v.due_on), animal: animal(v.cattle_id), vaccine: v.vaccine_name })),
        empty: 'None.',
      },
      {
        title: 'Given in this period',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'animal', label: 'Animal' },
          { key: 'vaccine', label: 'Vaccine' },
          { key: 'batch', label: 'Batch' },
          { key: 'group', label: 'Group' },
        ],
        rows: given.map((v) => ({ date: formatDate(v.administered_on), animal: animal(v.cattle_id), vaccine: v.vaccine_name, batch: v.batch_number ?? '', group: v.group_label ?? '' })),
        empty: 'None.',
      },
      {
        title: 'Group doses (as defined at the time)',
        columns: [
          { key: 'group', label: 'Group' },
          { key: 'definition', label: 'Definition' },
          { key: 'animals', label: 'Animals', numeric: true },
        ],
        rows: [...new Set(given.map((v) => v.group_batch_id).filter(Boolean))].map((g) => {
          const rows = given.filter((v) => v.group_batch_id === g);
          return { group: rows[0].group_label ?? '', definition: rows[0].group_definition ?? '', animals: String(rows.length) };
        }),
        empty: 'None.',
      },
    ],
    definitions: [
      'Covered: the animal received a completed dose within the vaccine’s schedule interval (365 days when no interval is recorded).',
      'Compliance: of the doses due in the period, the share recorded as given.',
      'Schedules come from your vet’s guidance; the app has no built-in calendar.',
    ],
    missing: schedules.length ? [] : ['No vaccination schedules recorded, so coverage uses a 365-day window.'],
  };
}

// --- Finance and stock ---------------------------------------------------------------------

export function financeReport(input: ReportInput, f: Filters): Report {
  const fin = input.finance;
  const customerName = new Map(fin.customers.map((c) => [c.id, c.name]));
  const filters: Record<string, string> = { Currency: f.currency };
  if (f.customerId) filters.Customer = customerName.get(f.customerId) ?? '';
  if (f.method) filters['Payment method'] = METHOD_LABELS[f.method];
  if (f.paid) filters['Payment status'] = f.paid === 'paid' ? 'Paid' : 'Unpaid';
  if (f.category) filters['Expense category'] = CATEGORY_LABELS[f.category as keyof typeof CATEGORY_LABELS];
  const due = saleDue(fin.sales, fin.payments, fin.allocations);
  const sales = fin.sales.filter(
    (s) =>
      s.currency === f.currency &&
      inRange(input.farmDate(s.sale_at), f) &&
      (!f.customerId || s.customer_id === f.customerId) &&
      (!f.method || s.payment_method === f.method) &&
      (!f.paid || (s.status === 'completed' && (f.paid === 'paid' ? !due.get(s.id) : !!due.get(s.id)))),
  );
  const payments = fin.payments.filter((p) => p.currency === f.currency && inRange(input.farmDate(p.paid_at), f) && (!f.customerId || p.customer_id === f.customerId) && (!f.method || p.method === f.method));
  const expenses = fin.expenses.filter((e) => e.currency === f.currency && inRange(e.expense_date, f) && (!f.category || e.category === f.category));
  // The summary follows the filters, so it always matches the tables under it. Balances are all-time,
  // so they are worked out from every record of the customers in view.
  const sum = summarizeMoney(f.currency, f.from, f.to, { ...fin, sales, payments, expenses }, input.farmDate);
  const owedNow = fin.customers
    .filter((c) => !f.customerId || c.id === f.customerId)
    .reduce((s, c) => s + Math.max(0, balances(c.id, fin.sales, fin.payments)[f.currency] ?? 0), 0);
  const salesFiltered = !!(f.customerId || f.method || f.paid);
  const anyFilter = salesFiltered || !!f.category;
  const days = reconcile(fin.movements, input.milk, f.from, f.to);
  const M = (c: number) => money(c, f.currency);
  const byCategory = Object.keys(CATEGORY_LABELS)
    .map((c) => ({ c, total: expenses.filter((e) => e.status === 'active' && e.category === c).reduce((s, e) => s + toCents(e.amount), 0) }))
    .filter((x) => x.total);
  return {
    ...base('finance', 'Sales, money and stock', input, f, filters, `${f.currency}; litres (L)`),
    summary: [
      { label: 'Sales revenue', value: M(sum.revenueCents), note: `${sum.salesCount} sales, ${L(sum.litresCl)}` },
      { label: 'Payments received', value: M(sum.receiptsCents) },
      ...(sum.refundsCents ? [{ label: 'Refunds paid out', value: M(sum.refundsCents) }] : []),
      ...(sum.adjustmentsCents ? [{ label: 'Discounts and write-offs', value: M(sum.adjustmentsCents) }] : []),
      // Farm expenses are not about a customer or payment method: left out while those filters are on.
      ...(salesFiltered ? [] : [{ label: f.category ? `${CATEGORY_LABELS[f.category as keyof typeof CATEGORY_LABELS]} expenses` : 'Recorded expenses', value: M(sum.expensesCents) }]),
      ...(anyFilter ? [] : [{ label: 'Recorded operating result', value: M(sum.operatingResultCents), note: 'Sales less discounts and write-offs, minus expenses. Not audited profit.' }]),
      { label: 'Customers owe now', value: M(owedNow) },
    ],
    tables: [
      {
        title: 'Sales',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'customer', label: 'Customer' },
          { key: 'litres', label: 'L', numeric: true },
          { key: 'price', label: 'Price/L', numeric: true },
          { key: 'total', label: 'Total', numeric: true },
          { key: 'due', label: 'Due', numeric: true },
          { key: 'status', label: 'Status' },
        ],
        rows: sales.map((s) => ({
          date: formatDate(input.farmDate(s.sale_at)),
          customer: customerName.get(s.customer_id) ?? '',
          litres: s.quantity,
          price: s.price_per_litre + (s.price_source === 'override' ? '*' : ''),
          total: s.total,
          due: s.status === 'completed' ? (due.get(s.id) ? money(due.get(s.id)!, '').trim() : '0.00') : '',
          status: s.status === 'voided' ? `voided: ${s.void_reason ?? ''}` : s.corrects_sale_id ? 'correction' : '',
        })),
        empty: 'No sales.',
      },
      {
        title: 'Payments',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'customer', label: 'Customer' },
          { key: 'kind', label: 'Type' },
          { key: 'method', label: 'Method' },
          { key: 'amount', label: 'Amount', numeric: true },
          { key: 'status', label: 'Status' },
        ],
        rows: payments.map((p) => ({
          date: formatDate(input.farmDate(p.paid_at)),
          customer: customerName.get(p.customer_id) ?? '',
          kind: PAYMENT_KIND_LABELS[p.kind],
          method: METHOD_LABELS[p.method],
          amount: p.amount,
          status: p.status === 'voided' ? `voided: ${p.void_reason ?? ''}` : '',
        })),
        empty: 'No payments.',
      },
      {
        title: 'Customer balances now',
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'balance', label: 'Balance', numeric: true },
        ],
        rows: fin.customers
          .filter((c) => !f.customerId || c.id === f.customerId)
          .map((c) => ({ c, b: balances(c.id, fin.sales, fin.payments)[f.currency] ?? 0 }))
          .filter(({ b }) => b !== 0)
          .map(({ c, b }) => ({ customer: c.name, balance: b > 0 ? `owes ${money(b, '').trim()}` : `credit ${money(-b, '').trim()}` })),
        empty: 'Nobody owes anything.',
      },
      {
        title: 'Expenses by category',
        columns: [
          { key: 'category', label: 'Category' },
          { key: 'total', label: 'Total', numeric: true },
        ],
        rows: byCategory.map((x) => ({ category: CATEGORY_LABELS[x.c as keyof typeof CATEGORY_LABELS], total: money(x.total, '').trim() })),
        empty: 'No expenses.',
      },
      {
        title: 'Milk stock by day',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'opening', label: 'Open', numeric: true },
          { key: 'produced', label: 'Produced', numeric: true },
          { key: 'sold', label: 'Sold', numeric: true },
          { key: 'used', label: 'Used', numeric: true },
          { key: 'adjusted', label: '±', numeric: true },
          { key: 'closing', label: 'Close', numeric: true },
        ],
        rows: days.map((d) => ({
          date: formatDate(d.date),
          opening: litres(d.opening),
          produced: litres(d.produced),
          sold: litres(d.sold),
          used: litres(d.used),
          adjusted: litres(d.adjusted),
          closing: litres(d.closing),
        })),
        daily: true,
      },
    ],
    definitions: [
      'Sales revenue: the amount owed on completed sales in the period, paid or not (accrual basis). Voided sales are excluded.',
      'Payments received: money received in the period; refunds and discounts are shown separately.',
      'Recorded operating result: sales revenue less discounts and write-offs, minus recorded expenses; not audited profit.',
      'Closing stock = opening + eligible production − sales − milk use ± adjustments. Milk under withdrawal is never in stock.',
      '* after a price: a special price entered for that sale.',
      `Amounts are in ${f.currency}; other currencies are never added in.`,
    ],
    missing: days.some((d) => d.closing < 0) ? ['Stock went below zero on some days: check for missing production or wrong sales.'] : [],
  };
}

// --- Herd health trends ---------------------------------------------------------------------

/** Below this many animals, a share of the herd says more about chance than about the farm. */
const RATE_MIN_HERD = 20;
const CALF_MONTHS = 6;
const NOT_SET = 'Not set';

const monthOf = (d: string) => d.slice(0, 7);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Deaths and their causes, sales and their reasons, health problems by kind and month, cows that keep
 * getting ill, and what each kind of problem cost in money and in milk. Counts only from what was recorded.
 */
export function herdHealthReport(input: ReportInput, f: Filters): Report {
  const { animal, scopeAnimals, inScope, filters } = context(input, f);
  const conditionOf = (c: string | null | undefined) => (c ? CONDITION_LABELS[c as keyof typeof CONDITION_LABELS] : NOT_SET);
  const health = live(input.care.health).filter((h) => inScope.has(h.cattle_id));
  const cases = health.filter((h) => inRange(h.reported_on, f));
  const byId = new Map(health.map((h) => [h.id, h]));

  // Deaths and sales in the period.
  const deaths = scopeAnimals.filter((a) => a.status === 'deceased' && inRange(a.status_date, f));
  const sales = scopeAnimals.filter((a) => a.status === 'sold' && inRange(a.status_date, f));
  const ageAt = (a: Cattle) => (a.birth_date && a.status_date ? ageInMonths(a.birth_date, new Date(`${a.status_date}T12:00:00`)) : null);
  const isCalf = (a: Cattle) => {
    const m = ageAt(a);
    return m !== null && m < CALF_MONTHS;
  };
  const causeOf = (a: Cattle) => (a.status_reason ? (DEATH_CAUSE_LABELS[a.status_reason as keyof typeof DEATH_CAUSE_LABELS] ?? a.status_reason) : 'Not given');
  const saleReasonOf = (a: Cattle) => (a.status_reason ? (SALE_REASON_LABELS[a.status_reason as keyof typeof SALE_REASON_LABELS] ?? a.status_reason) : 'Not given');
  const tally = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  };

  // Herd size at the start of the period: on the farm then (born or bought by then, not yet gone).
  const herdAtStart = scopeAnimals.filter(
    (a) => (a.birth_date ?? a.acquisition_date ?? '0000') <= f.from && (a.status === 'active' || !a.status_date || a.status_date >= f.from),
  ).length;
  const rate = (n: number) => (herdAtStart >= RATE_MIN_HERD ? `${Math.round((n / herdAtStart) * 1000) / 10}% of ${herdAtStart} animals` : undefined);

  // Cows that keep getting the same problem (two or more cases in the period).
  const repeats = tally(cases.filter((h) => h.condition), (h) => `${h.cattle_id}|${h.condition}`).filter(([, rows]) => rows.length >= 2);

  // Costs: expenses recorded against a case or anything in its story (visits, treatments).
  const expenses = input.finance.expenses.filter((e) => e.status === 'active' && e.currency === f.currency);
  const caseCost = (h: (typeof cases)[number]) => {
    const ids = new Set(storyOf('health', h.id, input.care).map((x) => x.id));
    return expenses.filter((e) => e.care_id && ids.has(e.care_id)).reduce((sum, e) => sum + toCents(e.amount), 0);
  };

  // Milk held back by withdrawals in the period, traced to the kind of problem that was treated.
  const treatments = live(input.care.treatments);
  const heldBack = new Map<string, number>();
  for (const m of input.milk) {
    if (!m.restricted || m.status !== 'valid' || !inScope.has(m.cattle_id) || !inRange(m.production_date, f)) continue;
    const t = withdrawalCovering(treatments, m.cattle_id, m.production_date, m.session);
    const kind = t?.health_record_id ? conditionOf(byId.get(t.health_record_id)?.condition) : 'Treatment not linked to a concern';
    heldBack.set(kind, (heldBack.get(kind) ?? 0) + Math.round(Number(m.quantity) * 100));
  }

  const byCondition = tally(cases, (h) => conditionOf(h.condition));
  const months = [...new Set(cases.map((h) => monthOf(h.reported_on)))].sort();
  const shownConditions = byCondition.map(([c]) => c);
  const unset = cases.filter((h) => !h.condition).length;
  const noCause = deaths.filter((a) => !a.status_reason).length;
  const totalHeld = [...heldBack.values()].reduce((a, b) => a + b, 0);

  return {
    ...base('herd-health', 'Herd health trends', input, f, filters, 'animals and cases'),
    summary: [
      { label: 'Deaths', value: String(deaths.length), note: [`${deaths.filter(isCalf).length} calves under ${CALF_MONTHS} months`, rate(deaths.length)].filter(Boolean).join(' · ') },
      { label: 'Sold', value: String(sales.length), note: rate(sales.length) },
      { label: 'Health cases', value: String(cases.length), note: `${new Set(cases.map((h) => h.cattle_id)).size} animals` },
      { label: 'Milk held back', value: L(totalHeld), note: 'Under withdrawal after treatment' },
    ],
    tables: [
      {
        title: 'Deaths by cause',
        columns: [
          { key: 'cause', label: 'Cause' },
          { key: 'n', label: 'Deaths', numeric: true },
          { key: 'calves', label: 'Of which calves', numeric: true },
        ],
        rows: tally(deaths, causeOf).map(([cause, rows]) => ({ cause, n: String(rows.length), calves: String(rows.filter(isCalf).length) })),
        empty: 'No deaths in this period.',
      },
      {
        title: 'Each death',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'animal', label: 'Animal' },
          { key: 'age', label: 'Age' },
          { key: 'cause', label: 'Cause' },
          { key: 'illness', label: 'Illness' },
        ],
        rows: deaths
          .sort((a, b) => (b.status_date ?? '').localeCompare(a.status_date ?? ''))
          .map((a) => {
            const m = ageAt(a);
            const h = a.status_health_record_id ? byId.get(a.status_health_record_id) : undefined;
            return {
              date: formatDate(a.status_date),
              animal: animal(a.id),
              age: m === null ? 'Unknown' : m < 24 ? `${m} months` : `${Math.floor(m / 12)} years`,
              cause: causeOf(a),
              illness: h ? `${h.confirmed_diagnosis ?? h.suspected_issue ?? conditionOf(h.condition)}` : '',
            };
          }),
        empty: 'None.',
      },
      {
        title: 'Sales by reason',
        columns: [
          { key: 'reason', label: 'Reason' },
          { key: 'n', label: 'Animals', numeric: true },
        ],
        rows: tally(sales, saleReasonOf).map(([reason, rows]) => ({ reason, n: String(rows.length) })),
        empty: 'No sales in this period.',
      },
      {
        title: 'Health problems by kind',
        columns: [
          { key: 'kind', label: 'Kind of problem' },
          { key: 'cases', label: 'Cases', numeric: true },
          { key: 'animals', label: 'Animals', numeric: true },
          { key: 'died', label: 'Died', numeric: true },
          { key: 'cost', label: 'Cost', numeric: true },
        ],
        rows: byCondition.map(([kind, rows]) => ({
          kind,
          cases: String(rows.length),
          animals: String(new Set(rows.map((h) => h.cattle_id)).size),
          died: String(rows.filter((h) => h.recovery_status === 'died').length),
          cost: money(rows.reduce((sum, h) => sum + caseCost(h), 0), f.currency),
        })),
        empty: 'No health concerns in this period.',
      },
      {
        title: 'Cases by month',
        columns: [{ key: 'month', label: 'Month' }, ...shownConditions.map((c) => ({ key: c, label: c, numeric: true }))],
        rows: months.map((m) => ({
          month: monthLabel(m),
          ...Object.fromEntries(shownConditions.map((c) => [c, String(cases.filter((h) => monthOf(h.reported_on) === m && conditionOf(h.condition) === c).length)])),
        })),
        empty: 'No health concerns in this period.',
      },
      {
        title: 'Animals with repeat problems',
        columns: [
          { key: 'animal', label: 'Animal' },
          { key: 'kind', label: 'Kind of problem' },
          { key: 'cases', label: 'Cases', numeric: true },
        ],
        rows: repeats.map(([key, rows]) => ({ animal: animal(key.split('|')[0]), kind: conditionOf(rows[0].condition), cases: String(rows.length) })),
        empty: 'No animal had the same problem twice in this period.',
      },
      {
        title: 'Milk held back by kind of problem',
        columns: [
          { key: 'kind', label: 'Kind of problem' },
          { key: 'litres', label: 'Litres', numeric: true },
        ],
        rows: [...heldBack.entries()].sort((a, b) => b[1] - a[1]).map(([kind, cl]) => ({ kind, litres: L(cl) })),
        empty: 'No milk was held back in this period.',
      },
    ],
    definitions: [
      `A calf is an animal that died before ${CALF_MONTHS} months of age (from its birth date).`,
      `Shares of the herd are shown only for herds of ${RATE_MIN_HERD} or more animals at the start of the period; with fewer, one animal changes the figure too much to compare.`,
      'Kinds of problem are what the farmer or vet recorded on each health concern; the app does not diagnose.',
      'Cost: expenses recorded against a health concern, its vet visits and treatments.',
      'Milk held back: milk kept out of stock because a treatment’s withdrawal covered that milking.',
    ],
    missing: [
      ...(unset ? [`${unset} health concern${unset === 1 ? ' has' : 's have'} no kind of problem chosen; they are counted as “${NOT_SET}”.`] : []),
      ...(noCause ? [`${noCause} death${noCause === 1 ? ' has' : 's have'} no cause recorded.`] : []),
    ],
  };
}

export const REPORTS: { id: ReportId; title: string; build: (input: ReportInput, f: Filters) => Report; filters: ('animal' | 'breed' | 'customer' | 'method' | 'paid' | 'category')[] }[] = [
  { id: 'herd', title: 'Herd', build: herdReport, filters: ['breed'] },
  { id: 'production', title: 'Milk production', build: productionReport, filters: ['animal', 'breed'] },
  { id: 'health', title: 'Animal health', build: healthReport, filters: ['animal', 'breed'] },
  { id: 'herd-health', title: 'Herd health trends', build: herdHealthReport, filters: ['breed'] },
  { id: 'reproduction', title: 'Reproduction', build: reproductionReport, filters: ['animal', 'breed'] },
  { id: 'vaccination', title: 'Vaccination', build: vaccinationReport, filters: ['animal', 'breed'] },
  { id: 'finance', title: 'Sales, money and stock', build: financeReport, filters: ['customer', 'method', 'paid', 'category'] },
];
