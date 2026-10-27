import { useState } from 'react';
import { Text } from 'react-native';
import { CURRENCIES } from '../lib/account';
import { useDraft } from '../lib/useDraft';
import { Chips } from '../ui/Chips';
import { DateField, toDateString } from '../ui/DateField';
import { Button, Choice, Notice, TextField, Toggle } from '../ui/form';
import { useTheme } from '../ui/theme';
import { type Breed, type Cattle, type CattleFields, PRODUCTION_LABELS, type ProductionStatus, REPRODUCTIVE_LABELS } from './model';
import { ParentPicker } from './ParentPicker';

// Optional text fields are edited as '' and saved as null.
type TextKey =
  | 'ear_tag'
  | 'name'
  | 'breed_id'
  | 'birth_date'
  | 'acquisition_date'
  | 'acquisition_source'
  | 'purchase_price'
  | 'purchase_currency'
  | 'weight_kg'
  | 'dam_id'
  | 'sire_id'
  | 'sire_identifier'
  | 'notes';
type Form = Omit<CattleFields, TextKey> & Record<TextKey | 'age_years' | 'age_months', string>;
type Errors = Partial<Record<keyof Form, string>>;

export function emptyFields(currency: string): CattleFields {
  return {
    ear_tag: null,
    name: null,
    breed_id: null,
    sex: 'female',
    birth_date: null,
    birth_date_estimated: false,
    acquisition_date: null,
    acquisition_source: null,
    purchase_price: null,
    purchase_currency: currency,
    weight_kg: null,
    dam_id: null,
    sire_id: null,
    sire_identifier: null,
    reproductive_status: 'not_applicable',
    production_status: 'heifer',
    notes: null,
  };
}

function toForm(f: CattleFields): Form {
  const s = (v: string | null) => v ?? '';
  return {
    ...f,
    ear_tag: s(f.ear_tag),
    name: s(f.name),
    breed_id: s(f.breed_id),
    birth_date: s(f.birth_date),
    acquisition_date: s(f.acquisition_date),
    acquisition_source: s(f.acquisition_source),
    purchase_price: s(f.purchase_price),
    purchase_currency: s(f.purchase_currency),
    weight_kg: s(f.weight_kg),
    dam_id: s(f.dam_id),
    sire_id: s(f.sire_id),
    sire_identifier: s(f.sire_identifier),
    notes: s(f.notes),
    age_years: '',
    age_months: '',
  };
}

function fromForm(f: Form): CattleFields {
  const n = (v: string) => (v.trim() === '' ? null : v.trim());
  const decimal = (v: string) => (v.trim() === '' ? null : v.trim().replace(',', '.'));
  return {
    ear_tag: n(f.ear_tag),
    name: n(f.name),
    breed_id: n(f.breed_id),
    sex: f.sex,
    birth_date: n(f.birth_date),
    birth_date_estimated: f.birth_date_estimated,
    acquisition_date: n(f.acquisition_date),
    acquisition_source: n(f.acquisition_source),
    purchase_price: decimal(f.purchase_price),
    purchase_currency: decimal(f.purchase_price) ? n(f.purchase_currency) : null,
    weight_kg: decimal(f.weight_kg),
    dam_id: n(f.dam_id),
    sire_id: n(f.sire_id),
    sire_identifier: n(f.sire_identifier),
    reproductive_status: f.reproductive_status,
    production_status: f.production_status,
    notes: n(f.notes),
  };
}

/** Birth date from an approximate age, counted back from today. */
function birthDateFromAge(years: string, months: string) {
  const total = (Number(years) || 0) * 12 + (Number(months) || 0);
  if (!total) return '';
  const d = new Date();
  d.setMonth(d.getMonth() - total);
  return toDateString(d);
}

function validate(f: Form, others: Cattle[]): Errors {
  const e: Errors = {};
  const tag = f.ear_tag.trim().toLowerCase();
  if (tag && others.some((a) => a.ear_tag?.toLowerCase() === tag)) e.ear_tag = 'Another animal in your herd already has this ear tag.';
  if (f.weight_kg.trim() && !/^\d{1,5}([.,]\d{1,2})?$/.test(f.weight_kg.trim())) e.weight_kg = 'Enter the weight in kg, e.g. 420 or 420.5.';
  if (f.weight_kg.trim() && Number(f.weight_kg.replace(',', '.')) <= 0) e.weight_kg = 'Weight must be more than 0.';
  if (f.purchase_price.trim() && !/^\d{1,12}([.,]\d{1,2})?$/.test(f.purchase_price.trim())) e.purchase_price = 'Enter an amount, e.g. 15000 or 15000.50.';
  if (f.sex === 'male' && ['lactating', 'dry'].includes(f.production_status)) e.production_status = 'Milking status applies to females only.';
  if (f.birth_date_estimated && !f.birth_date) e.age_years = 'Enter an approximate age.';
  return e;
}

export function AnimalForm({
  draftKey,
  initial,
  selfId,
  animals,
  breeds,
  submitLabel,
  onSubmit,
}: {
  draftKey: string;
  initial: CattleFields;
  selfId?: string;
  animals: Cattle[];
  breeds: Breed[];
  submitLabel: string;
  onSubmit: (fields: CattleFields) => void;
}) {
  const t = useTheme();
  const [form, update, clearDraft] = useDraft<Form>(draftKey, () => toForm(initial));
  const [errors, setErrors] = useState<Errors>({});
  const others = animals.filter((a) => a.id !== selfId);
  const female = form.sex === 'female';

  function submit() {
    const found = validate(form, others);
    setErrors(found);
    if (Object.keys(found).length) return;
    onSubmit(fromForm(form));
    clearDraft();
  }

  const setAge = (age_years: string, age_months: string) =>
    update({ age_years, age_months, birth_date: birthDateFromAge(age_years, age_months) });

  const productionOptions = (Object.keys(PRODUCTION_LABELS) as ProductionStatus[])
    .filter((p) => female || !['lactating', 'dry'].includes(p))
    .map((p) => ({ value: p, label: PRODUCTION_LABELS[p] }));

  return (
    <>
      {Object.keys(errors).length ? <Notice tone="error">Please check the highlighted fields.</Notice> : null}

      <TextField label="Ear tag (optional)" hint="Leave empty if the animal is not tagged yet" value={form.ear_tag} onChangeText={(ear_tag) => update({ ear_tag })} error={errors.ear_tag} autoCapitalize="characters" autoCorrect={false} />
      <TextField label="Name (optional)" value={form.name} onChangeText={(name) => update({ name })} />
      <Choice
        label="Sex"
        value={form.sex}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
        ]}
        onChange={(sex) =>
          update({
            sex,
            ...(sex === 'male' && { reproductive_status: 'not_applicable' as const, production_status: 'not_applicable' as const }),
          })
        }
      />
      <Chips label="Breed" value={form.breed_id || null} options={breeds.filter((b) => b.active || b.id === form.breed_id).map((b) => ({ value: b.id, label: b.name }))} onChange={(id) => update({ breed_id: id ?? '' })} />

      <Toggle label="I don’t know the exact birth date" value={form.birth_date_estimated} onChange={(birth_date_estimated) => update({ birth_date_estimated, birth_date: '' })} />
      {form.birth_date_estimated ? (
        <>
          <TextField label="Approximate age: years" value={form.age_years} onChangeText={(y) => setAge(y, form.age_months)} keyboardType="number-pad" maxLength={2} error={errors.age_years} />
          <TextField label="and months" value={form.age_months} onChangeText={(m) => setAge(form.age_years, m)} keyboardType="number-pad" maxLength={2} />
        </>
      ) : (
        <DateField label="Birth date (optional)" value={form.birth_date || null} onChange={(d) => update({ birth_date: d ?? '' })} />
      )}

      <Chips label="Production" value={form.production_status} options={productionOptions} onChange={(p) => p && update({ production_status: p })} allowClear={false} />
      {errors.production_status ? <Text style={{ color: t.danger }}>{errors.production_status}</Text> : null}
      {female ? (
        <>
          <Chips
            label="Reproduction"
            value={form.reproductive_status === 'open' || form.reproductive_status === 'not_applicable' ? form.reproductive_status : null}
            options={(['open', 'not_applicable'] as const).map((r) => ({ value: r, label: REPRODUCTIVE_LABELS[r] }))}
            onChange={(r) => r && update({ reproductive_status: r })}
            allowClear={false}
          />
          <Text style={{ color: t.textMuted, fontSize: 14 }}>Pregnancy is recorded from a pregnancy check, not set here.</Text>
        </>
      ) : null}

      <TextField label="Weight in kg (optional)" value={form.weight_kg} onChangeText={(weight_kg) => update({ weight_kg })} error={errors.weight_kg} keyboardType="decimal-pad" />

      <ParentPicker label="Mother" sex="female" value={form.dam_id || null} animals={others} excludeId={selfId} onChange={(id) => update({ dam_id: id ?? '' })} />
      <ParentPicker label="Father" sex="male" value={form.sire_id || null} animals={others} excludeId={selfId} onChange={(id) => update({ sire_id: id ?? '' })} />
      <TextField label="Bull or semen ID (if the father is not in your herd)" value={form.sire_identifier} onChangeText={(sire_identifier) => update({ sire_identifier })} />

      <DateField label="Date acquired (optional)" value={form.acquisition_date || null} onChange={(d) => update({ acquisition_date: d ?? '' })} />
      <TextField label="Bought from / source (optional)" value={form.acquisition_source} onChangeText={(acquisition_source) => update({ acquisition_source })} />
      <TextField label="Purchase price (optional)" value={form.purchase_price} onChangeText={(purchase_price) => update({ purchase_price })} error={errors.purchase_price} keyboardType="decimal-pad" />
      {form.purchase_price.trim() ? (
        <Chips label="Currency" value={form.purchase_currency || null} options={CURRENCIES} onChange={(c) => c && update({ purchase_currency: c })} allowClear={false} />
      ) : null}
      <TextField label="Notes (optional)" value={form.notes} onChangeText={(notes) => update({ notes })} multiline />

      <Button label={submitLabel} onPress={submit} />
    </>
  );
}
