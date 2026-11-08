import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

async function farmWithCow(animal: object = {}) {
  const f = await h.farmer();
  const cowId = randomUUID();
  expect((await f.call('POST', '/v1/cattle', { id: cowId, sex: 'female', production_status: 'lactating', ...animal })).statusCode).toBe(201);
  return { ...f, cowId };
}

const cow = async (f: Awaited<ReturnType<typeof farmWithCow>>) => (await f.call('GET', `/v1/cattle/${f.cowId}`)).json();

async function stock(ownerId: string) {
  const { rows } = await h.db.query(`select coalesce(sum(quantity), 0)::text as l from public.milk_stock_movements where owner_id = $1`, [ownerId]);
  return rows[0].l as string;
}

describe('treatments and milk withdrawal', () => {
  it('re-marks milk already recorded in the withdrawal window, and restores it when the treatment is removed', async () => {
    const f = await farmWithCow();
    const owner = await f.ownerId();
    const milk = (await f.call('POST', '/v1/milk-production', { id: randomUUID(), cattle_id: f.cowId, production_date: '2026-10-10', session: 'morning', quantity: '12' })).json();
    expect(await stock(owner)).toBe('12.00');

    // Recorded afterwards; ends 10:00 Lusaka on the 10th; the treatment itself finished on the 3rd.
    const res = await f.call('POST', '/v1/treatments', {
      id: randomUUID(),
      cattle_id: f.cowId,
      medication: 'Oxytetracycline',
      dosage_instructions: 'As prescribed by Dr Banda',
      started_on: '2026-10-01',
      completed_on: '2026-10-03',
      requires_milk_withdrawal: true,
      withdrawal_period_text: '7 days after last dose',
      withdrawal_ends_at: '2026-10-10T10:00:00+02:00',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().milk_entries_rechecked).toBe(1);
    const entries = (await f.call('GET', '/v1/milk-production')).json();
    expect(entries.find((e: { id: string }) => e.id === milk.id).restricted).toBe(true);
    expect(await stock(owner)).toBe('0.00');

    const removed = await f.call('POST', `/v1/treatments/${res.json().id}/remove`, { reason: 'Entered for the wrong cow' }, { 'if-match': '1' });
    expect(removed.json().milk_entries_rechecked).toBe(1);
    expect(await stock(owner)).toBe('12.00');
  });

  it.each([
    [{ requires_milk_withdrawal: true }, 'withdrawal_ends_at'],
    [{ requires_milk_withdrawal: true, withdrawal_ends_at: '2026-09-01T00:00:00Z' }, 'withdrawal_ends_at'],
    [{ completed_on: '2026-09-01' }, 'completed_on'],
    [{ medication: '' }, 'medication'],
  ])('rejects %j', async (extra, field) => {
    const f = await farmWithCow();
    const res = await f.call('POST', '/v1/treatments', { id: randomUUID(), cattle_id: f.cowId, medication: 'X', started_on: '2026-10-01', ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe(field);
  });
});

describe('breeding and pregnancy', () => {
  it('breeding alone never makes a cow pregnant; the exam result does (spec scenario)', async () => {
    const f = await farmWithCow();
    const b = await f.call('POST', '/v1/breeding', { id: randomUUID(), cattle_id: f.cowId, event_type: 'artificial_insemination', event_at: '2026-09-01T08:00:00Z', bull_or_semen_id: 'ZM-AI-221' });
    expect(b.statusCode).toBe(201);
    expect((await cow(f)).reproductive_status).toBe('bred');

    // A pending check was scheduled from the farmer's interval (default 35 days).
    const checks = (await f.call('GET', `/v1/pregnancy-checks?cattle_id=${f.cowId}`)).json();
    expect(checks).toEqual([expect.objectContaining({ result: 'pending', scheduled_on: '2026-10-06', breeding_record_id: b.json().id })]);

    const exam = await f.call(
      'PATCH',
      `/v1/pregnancy-checks/${checks[0].id}`,
      { examined_on: '2026-10-06', result: 'pregnant', examiner: 'Dr Banda', expected_calving_on: '2027-06-11' },
      { 'if-match': '1' },
    );
    expect(exam.statusCode).toBe(200);
    expect((await cow(f)).reproductive_status).toBe('pregnant');
  });

  it('a negative exam makes the cow open; heat observations change nothing', async () => {
    const f = await farmWithCow();
    await f.call('POST', '/v1/breeding', { id: randomUUID(), cattle_id: f.cowId, event_type: 'heat_observed', event_at: '2026-09-01T08:00:00Z' });
    expect((await cow(f)).reproductive_status).toBe('not_applicable');
    await f.call('POST', '/v1/pregnancy-checks', { id: randomUUID(), cattle_id: f.cowId, examined_on: '2026-10-01', result: 'not_pregnant' });
    expect((await cow(f)).reproductive_status).toBe('open');
  });

  it('removing the breeding removes its pending check and the derived status', async () => {
    const f = await farmWithCow();
    const b = (await f.call('POST', '/v1/breeding', { id: randomUUID(), cattle_id: f.cowId, event_type: 'natural_mating', event_at: '2026-09-01T08:00:00Z' })).json();
    await f.call('POST', `/v1/breeding/${b.id}/remove`, { reason: 'Wrong cow' }, { 'if-match': '1' });
    expect((await f.call('GET', `/v1/pregnancy-checks?cattle_id=${f.cowId}`)).json()).toHaveLength(0);
    expect((await cow(f)).reproductive_status).toBe('open');
  });

  it.each([
    [{ result: 'pregnant' }, 'examined_on'],
    [{ examined_on: '2026-10-01', result: 'not_pregnant', expected_calving_on: '2027-06-01' }, 'expected_calving_on'],
    [{}, 'scheduled_on'],
  ])('rejects pregnancy check %j', async (extra, field) => {
    const f = await farmWithCow();
    const res = await f.call('POST', '/v1/pregnancy-checks', { id: randomUUID(), cattle_id: f.cowId, ...extra });
    expect(res.json().field).toBe(field);
  });

  it('only records breeding for females', async () => {
    const f = await h.farmer();
    const bull = randomUUID();
    await f.call('POST', '/v1/cattle', { id: bull, sex: 'male' });
    const res = await f.call('POST', '/v1/breeding', { id: randomUUID(), cattle_id: bull, event_type: 'natural_mating', event_at: '2026-09-01T08:00:00Z' });
    expect(res.json().field).toBe('cattle_id');
  });
});

describe('calving', () => {
  it('registers the calf linked to its mother, and puts the mother in milk and open', async () => {
    const f = await farmWithCow({ production_status: 'dry', ear_tag: 'DAM-1' });
    await f.call('POST', '/v1/breeding', { id: randomUUID(), cattle_id: f.cowId, event_type: 'artificial_insemination', event_at: '2025-12-01T08:00:00Z', bull_or_semen_id: 'SEMEN-9' });
    const calfId = randomUUID();
    const res = await f.call('POST', '/v1/calvings', {
      id: randomUUID(),
      dam_id: f.cowId,
      calved_on: '2026-09-10',
      outcome: 'live',
      calf: { id: calfId, sex: 'female', ear_tag: 'CALF-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().calf_id).toBe(calfId);
    const calf = (await f.call('GET', `/v1/cattle/${calfId}`)).json();
    expect(calf).toMatchObject({ dam_id: f.cowId, birth_date: '2026-09-10', production_status: 'calf', sire_identifier: 'SEMEN-9', ear_tag: 'CALF-1' });
    expect(await cow(f)).toMatchObject({ reproductive_status: 'open', production_status: 'lactating' });
  });

  it('will not register a calf for a stillbirth', async () => {
    const f = await farmWithCow();
    const res = await f.call('POST', '/v1/calvings', { id: randomUUID(), dam_id: f.cowId, calved_on: '2026-09-10', outcome: 'stillborn', calf: { id: randomUUID(), sex: 'male' } });
    expect(res.json().field).toBe('calf');
  });
});

describe('vaccination', () => {
  it('schedules the next dose once when a dose with a next due date is completed', async () => {
    const f = await farmWithCow();
    const due = (await f.call('POST', '/v1/vaccinations', { id: randomUUID(), cattle_id: f.cowId, vaccine_name: 'Lumpy skin disease', due_on: '2026-11-03' })).json();
    expect(due.status).toBe('scheduled');

    const done = await f.call('PATCH', `/v1/vaccinations/${due.id}`, { status: 'completed', administered_on: '2026-10-20', batch_number: 'LSD-44', next_due_on: '2027-10-20' }, { 'if-match': '1' });
    expect(done.statusCode).toBe(200);
    await f.call('PATCH', `/v1/vaccinations/${due.id}`, { notes: 'No reaction' }, { 'if-match': '2' });
    const all = (await f.call('GET', `/v1/vaccinations?cattle_id=${f.cowId}`)).json();
    expect(all.filter((v: { status: string }) => v.status === 'scheduled')).toEqual([expect.objectContaining({ due_on: '2027-10-20', is_booster: true })]);
  });

  it('keeps the group definition and the animals of a group dose', async () => {
    const f = await h.farmer();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) await f.call('POST', '/v1/cattle', { id, sex: 'female' });
    const group = { group_batch_id: randomUUID(), group_label: 'Milking herd', group_definition: 'All cows in milk on 20 Oct 2026' };
    for (const id of ids) {
      expect((await f.call('POST', '/v1/vaccinations', { id: randomUUID(), cattle_id: id, vaccine_name: 'FMD', status: 'completed', administered_on: '2026-10-20', ...group })).statusCode).toBe(201);
    }
    const { rows } = await h.db.query('select cattle_id, group_definition from public.vaccination_records where group_batch_id = $1', [group.group_batch_id]);
    expect(rows.map((r) => r.cattle_id).sort()).toEqual([...ids].sort());
    expect(rows.every((r) => r.group_definition === group.group_definition)).toBe(true);
  });

  it('requires a date given for a completed dose', async () => {
    const f = await farmWithCow();
    const res = await f.call('POST', '/v1/vaccinations', { id: randomUUID(), cattle_id: f.cowId, vaccine_name: 'FMD', status: 'completed' });
    expect(res.json().field).toBe('administered_on');
  });
});

describe('health records and common lifecycle', () => {
  it('distinguishes suspected from confirmed conditions', async () => {
    const f = await farmWithCow();
    const res = await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: f.cowId, reported_on: '2026-10-20', condition_status: 'confirmed' });
    expect(res.json().field).toBe('confirmed_diagnosis');
    const ok = await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: f.cowId, reported_on: '2026-10-20', suspected_issue: 'Mastitis', urgent: true });
    expect(ok.json()).toMatchObject({ condition_status: 'suspected', urgent: true, recovery_status: 'ongoing' });
  });

  it('rejects a vet visit linked to another cow’s health record', async () => {
    const f = await farmWithCow();
    const other = randomUUID();
    await f.call('POST', '/v1/cattle', { id: other, sex: 'female' });
    const hr = (await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: other, reported_on: '2026-10-20' })).json();
    const res = await f.call('POST', '/v1/vet-visits', { id: randomUUID(), cattle_id: f.cowId, health_record_id: hr.id, visit_at: '2026-10-21T09:00:00Z' });
    expect(res.json().field).toBe('health_record_id');
  });

  it('updates with If-Match, removes with a reason, and syncs the removal', async () => {
    const f = await farmWithCow();
    const hr = (await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: f.cowId, reported_on: '2026-10-20', suspected_issue: 'Lame' })).json();
    expect((await f.call('PATCH', `/v1/health-records/${hr.id}`, { recovery_status: 'recovered' }, { 'if-match': '1' })).json().version).toBe(2);
    expect((await f.call('PATCH', `/v1/health-records/${hr.id}`, { notes: 'x' }, { 'if-match': '1' })).json().error).toBe('version_conflict');
    expect((await f.call('POST', `/v1/health-records/${hr.id}/remove`, {}, { 'if-match': '2' })).json().field).toBe('reason');
    await f.call('POST', `/v1/health-records/${hr.id}/remove`, { reason: 'Duplicate' }, { 'if-match': '2' });

    expect((await f.call('GET', '/v1/health-records')).json()).toHaveLength(0);
    const pulled = (await f.call('GET', '/v1/sync/pull?entity=animal_health_records')).json().rows;
    expect(pulled[0]).toMatchObject({ id: hr.id, delete_reason: 'Duplicate' });
    expect(pulled[0].deleted_at).not.toBeNull();
    const { rows } = await h.db.query('select action from public.audit_logs where entity_id = $1 order by id', [hr.id]);
    expect(rows.map((r) => r.action)).toEqual(['animal_health_records.created', 'animal_health_records.updated', 'animal_health_records.removed']);
  });

  it('shows care records on the animal timeline, but not removed ones', async () => {
    const f = await farmWithCow();
    await f.call('POST', '/v1/treatments', { id: randomUUID(), cattle_id: f.cowId, medication: 'Penicillin', started_on: '2026-10-01' });
    const gone = (await f.call('POST', '/v1/treatments', { id: randomUUID(), cattle_id: f.cowId, medication: 'Mistake', started_on: '2026-10-02' })).json();
    await f.call('POST', `/v1/treatments/${gone.id}/remove`, { reason: 'Typo' }, { 'if-match': '1' });
    const titles = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json().map((e: { title: string }) => e.title);
    expect(titles).toContain('Treatment: Penicillin');
    expect(titles).not.toContain('Treatment: Mistake');
  });

  it('records why an animal died, closes the illness behind it, and keeps the condition of each case', async () => {
    const f = await farmWithCow();
    const concern = (await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: f.cowId, reported_on: '2026-10-20', condition: 'tick_borne', suspected_issue: 'East Coast fever' })).json();
    expect(concern.condition).toBe('tick_borne');
    expect((await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: f.cowId, reported_on: '2026-10-20', condition: 'cancer' })).json().field).toBe('condition');

    const died = (body: object) => f.call('POST', `/v1/cattle/${f.cowId}/status`, { status: 'deceased', status_date: '2026-10-25', ...body }, { 'if-match': '1' });
    expect((await died({ status_reason: 'low_yield' })).json().field).toBe('status_reason'); // a reason for a sale, not a death
    const other = await farmWithCow();
    const theirs = (await other.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: other.cowId, reported_on: '2026-10-20' })).json();
    expect((await died({ status_reason: 'illness', status_health_record_id: theirs.id })).json().field).toBe('status_health_record_id');

    const ok = (await died({ status_reason: 'illness', status_health_record_id: concern.id })).json();
    expect(ok).toMatchObject({ status: 'deceased', status_reason: 'illness', status_health_record_id: concern.id });
    expect((await f.call('GET', `/v1/health-records?cattle_id=${f.cowId}`)).json().find((h: { id: string }) => h.id === concern.id).recovery_status).toBe('died');
    const titles = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json().map((e: { title: string }) => e.title);
    expect(titles).toContain('Died (illness)');
  });

  it('joins mating, pregnancy check and calving into one story on the timeline', async () => {
    const f = await farmWithCow();
    const mating = randomUUID();
    await f.call('POST', '/v1/breeding', { id: mating, cattle_id: f.cowId, event_type: 'artificial_insemination', event_at: '2025-11-01T08:00:00Z', bull_or_semen_id: 'FR-1' });
    const check = randomUUID();
    await f.call('POST', '/v1/pregnancy-checks', { id: check, cattle_id: f.cowId, breeding_record_id: mating, examined_on: '2025-12-06', result: 'pregnant' });
    const calving = (await f.call('POST', '/v1/calvings', { id: randomUUID(), dam_id: f.cowId, calved_on: '2026-08-10', outcome: 'live' })).json();
    expect(calving.pregnancy_check_id).toBe(check); // found on its own

    const events: { kind: string; episode: string | null; record_id: string | null }[] = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json();
    const story = events.filter((e) => e.episode === mating).map((e) => e.kind);
    expect(story).toEqual(['calving', 'pregnancy_check', 'breeding']);
    expect(events.find((e) => e.kind === 'calving')?.record_id).toBe(calving.id);
  });

  it('links an action on a milk alert to the health concern it led to, and an expense to a care record', async () => {
    const f = await farmWithCow();
    const concern = (await f.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: f.cowId, reported_on: '2026-10-20', suspected_issue: 'Mastitis' })).json();
    const action = await f.call('POST', '/v1/alert-actions', {
      id: randomUUID(), cattle_id: f.cowId, alert_type: 'milk_drop', action_taken: 'called_vet', action_on: '2026-10-20', status: 'resolved', resolved_on: '2026-10-21', health_record_id: concern.id,
    });
    expect(action.json().health_record_id).toBe(concern.id);
    const events: { kind: string; episode: string | null }[] = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json();
    expect(events.filter((e) => e.episode === concern.id).map((e) => e.kind).sort()).toEqual(['alert_action', 'health']);

    const other = await farmWithCow();
    const theirs = (await other.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: other.cowId, reported_on: '2026-10-20' })).json();
    const expense = { expense_date: '2026-10-21', category: 'veterinary_care', amount: '700', currency: 'ZMW' };
    const ok = await f.call('POST', '/v1/expenses', { id: randomUUID(), ...expense, care_kind: 'health', care_id: concern.id });
    expect(ok.json()).toMatchObject({ care_kind: 'health', care_id: concern.id });
    expect((await f.call('POST', '/v1/expenses', { id: randomUUID(), ...expense, care_kind: 'health', care_id: theirs.id })).json().field).toBe('care_id');
    expect((await f.call('POST', '/v1/expenses', { id: randomUUID(), ...expense, care_kind: 'health' })).json().field).toBe('care_id');
  });

  it('words the timeline for the farmer, and leaves out what has not happened yet', async () => {
    const f = await farmWithCow();
    await f.call('POST', '/v1/treatments', {
      id: randomUUID(),
      cattle_id: f.cowId,
      medication: 'Oxytetracycline',
      started_on: '2026-10-01',
      requires_milk_withdrawal: true,
      withdrawal_ends_at: '2026-10-10T10:00:00+02:00',
    });
    await f.call('POST', '/v1/breeding', { id: randomUUID(), cattle_id: f.cowId, event_type: 'heat_observed', event_at: '2026-09-01T08:00:00Z' });
    await f.call('POST', '/v1/vaccinations', { id: randomUUID(), cattle_id: f.cowId, vaccine_name: 'FMD', status: 'completed', administered_on: '2026-10-20' });
    await f.call('POST', '/v1/vaccinations', { id: randomUUID(), cattle_id: f.cowId, vaccine_name: 'Lumpy skin disease', due_on: '2099-01-01' });
    await f.call('POST', '/v1/pregnancy-checks', { id: randomUUID(), cattle_id: f.cowId, scheduled_on: '2099-01-01' });
    const events: { title: string; detail: string | null }[] = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json();
    const titles = events.map((e) => e.title);

    expect(events.find((e) => e.title === 'Treatment: Oxytetracycline')?.detail).toBe('Milk withdrawal until 10 Oct 2026, 10:00');
    expect(titles).toContain('Heat seen');
    expect(titles).toContain('Vaccination: FMD');
    expect(titles.some((x) => x.includes('Lumpy skin'))).toBe(false);
    expect(titles.some((x) => x.startsWith('Pregnancy check'))).toBe(false);
    expect(titles.some((x) => x.includes('cattle.') || x.includes('_'))).toBe(false);
  });

  it('records an action on an alert, needs a follow-up date while watching, and an outcome date to resolve', async () => {
    const f = await farmWithCow();
    const base = { cattle_id: f.cowId, alert_type: 'milk_drop', alert_reason: 'Milk down 39%: 11 L, usually 18 L', action_taken: 'checked_feed_water', action_on: '2026-10-20' };
    expect((await f.call('POST', '/v1/alert-actions', { id: randomUUID(), ...base })).json().field).toBe('follow_up_on');
    const act = (await f.call('POST', '/v1/alert-actions', { id: randomUUID(), ...base, follow_up_on: '2026-10-23' })).json();
    expect(act).toMatchObject({ status: 'monitoring', follow_up_on: '2026-10-23' });

    expect((await f.call('PATCH', `/v1/alert-actions/${act.id}`, { status: 'resolved' }, { 'if-match': '1' })).json().field).toBe('resolved_on');
    expect((await f.call('PATCH', `/v1/alert-actions/${act.id}`, { status: 'resolved', resolved_on: '2026-10-19' }, { 'if-match': '1' })).json().field).toBe('resolved_on');
    const done = (await f.call('PATCH', `/v1/alert-actions/${act.id}`, { status: 'resolved', resolved_on: '2026-10-23', outcome: 'Water trough was blocked' }, { 'if-match': '1' })).json();
    expect(done).toMatchObject({ status: 'resolved', version: 2 });

    expect((await f.call('GET', '/v1/sync/pull?entity=alert_actions')).json().rows).toHaveLength(1);
    const titles = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json().map((e: { title: string }) => e.title);
    expect(titles).toContain('Milk alert: checked feed and water (resolved)');
    expect((await f.call('DELETE', `/v1/cattle/${f.cowId}`, undefined, { 'if-match': '1' })).json().error).toBe('has_history');
  });

  it('keeps every care record away from other farmers', async () => {
    const a = await farmWithCow();
    const b = await h.farmer();
    const hr = (await a.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: a.cowId, reported_on: '2026-10-20' })).json();
    expect((await b.call('POST', '/v1/health-records', { id: randomUUID(), cattle_id: a.cowId, reported_on: '2026-10-20' })).json().field).toBe('cattle_id');
    expect((await b.call('PATCH', `/v1/health-records/${hr.id}`, { notes: 'mine' }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('POST', `/v1/health-records/${hr.id}/remove`, { reason: 'mine' }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('GET', '/v1/health-records')).json()).toHaveLength(0);
    for (const entity of ['animal_health_records', 'treatments', 'breeding_records', 'pregnancy_checks', 'calving_records', 'vaccination_records']) {
      expect((await b.call('GET', `/v1/sync/pull?entity=${entity}`)).json().rows).toHaveLength(0);
    }
  });
});
