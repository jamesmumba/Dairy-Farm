import { describe, expect, it } from 'vitest';
import { CARE_FORMS, type FormContext, fromRecord, toBody, validate } from '../src/care/forms';

const ctx: FormContext = {
  today: '2026-10-28',
  now: '2026-10-28T09:00:00.000Z',
  animals: [],
  intervals: { pregnancy_check_days: 35, gestation_days: 283 },
  care: {
    health: [],
    visits: [],
    treatments: [],
    checks: [],
    calvings: [],
    vaccinations: [],
    breeding: [
      { id: 'b1', cattle_id: 'cow', event_type: 'artificial_insemination', event_at: '2026-01-10T08:00:00Z', bull_or_semen_id: null, performed_by: null, notes: null, deleted_at: null, delete_reason: null, version: 1 },
    ],
    schedules: [
      { id: 's1', vaccine_name: 'Lumpy skin disease', target_disease: 'LSD', interval_days: 365, reminder_offsets_days: [30, 7, 1], guidance_source: 'Vet', active: true, deleted_at: null, delete_reason: null, version: 1 },
    ],
  },
};

const values = (kind: keyof typeof CARE_FORMS, extra = {}) => ({ ...CARE_FORMS[kind].defaults(ctx), ...extra });

describe('treatment form', () => {
  it('needs the vet’s withdrawal end time when withdrawal applies', () => {
    const v = values('treatment', { cattle_id: 'cow', medication: 'Oxytetracycline', requires_milk_withdrawal: true });
    expect(validate(CARE_FORMS.treatment, v)?.[0]).toBe('withdrawal_ends_at');
    expect(validate(CARE_FORMS.treatment, { ...v, withdrawal_ends_at: '2026-10-31T10:00:00.000Z' })).toBeNull();
  });

  it('sends hidden withdrawal fields as null, never stale values', () => {
    const body = toBody(CARE_FORMS.treatment, values('treatment', { cattle_id: 'cow', medication: 'X', withdrawal_period_text: '' }));
    expect(body).toMatchObject({ requires_milk_withdrawal: false, withdrawal_ends_at: null, withdrawal_period_text: null, started_on: '2026-10-28' });
  });
});

describe('pregnancy check form', () => {
  it('prefills expected calving from the breeding date and the farmer’s gestation interval', () => {
    const v = values('pregnancy-check', { cattle_id: 'cow', breeding_record_id: 'b1', result: 'pregnant' });
    expect(CARE_FORMS['pregnancy-check'].onChange!('result', v, ctx)).toEqual({ expected_calving_on: '2026-10-20' }); // 10 Jan + 283 days
  });

  it('requires an exam date for a result', () => {
    const v = values('pregnancy-check', { cattle_id: 'cow', result: 'not_pregnant', examined_on: '' });
    expect(validate(CARE_FORMS['pregnancy-check'], v)?.[0]).toBe('examined_on');
  });
});

describe('vaccination form', () => {
  it('fills the vaccine and next dose from the chosen schedule', () => {
    const v = values('vaccination', { cattle_id: 'cow', schedule_id: 's1' });
    expect(CARE_FORMS.vaccination.onChange!('schedule_id', v, ctx)).toEqual({ vaccine_name: 'Lumpy skin disease', target_disease: 'LSD', next_due_on: '2027-10-28' });
  });

  it('round-trips a schedule’s reminder days', () => {
    const body = toBody(CARE_FORMS.schedule, values('schedule', { vaccine_name: 'FMD', interval_days: '180' }));
    expect(body).toMatchObject({ interval_days: 180, reminder_offsets_days: [30, 7, 1], active: true });
    expect(fromRecord(CARE_FORMS.schedule, body).reminder_offsets_days).toBe('30, 7, 1');
    expect(validate(CARE_FORMS.schedule, { ...values('schedule'), vaccine_name: 'FMD', reminder_offsets_days: '30; 7' })?.[0]).toBe('reminder_offsets_days');
  });
});

describe('calving form', () => {
  it('registers a calf only for a live birth', () => {
    const live = CARE_FORMS.calving.createOnly!(values('calving', { dam_id: 'cow', calf_ear_tag: 'C-1' }));
    expect(live.calf).toMatchObject({ sex: 'female', ear_tag: 'C-1' });
    expect(CARE_FORMS.calving.createOnly!(values('calving', { dam_id: 'cow', outcome: 'stillborn' }))).toEqual({});
    // The calf fields are not columns of the calving record.
    expect(Object.keys(toBody(CARE_FORMS.calving, values('calving', { dam_id: 'cow' })))).not.toContain('calf_sex');
  });
});
