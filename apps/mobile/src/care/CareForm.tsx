import { Fragment, useState } from 'react';
import { Text } from 'react-native';
import type { Cattle } from '../animals/model';
import { ParentPicker } from '../animals/ParentPicker';
import { useDraft } from '../lib/useDraft';
import { Chips } from '../ui/Chips';
import { DateField, DateTimeField } from '../ui/DateField';
import { Button, FieldError, Notice, TextField, Toggle } from '../ui/form';
import { useTheme } from '../ui/theme';
import { CARE_FORMS, type FieldDef, type FormContext, type FormValues, toBody, validate } from './forms';
import type { CareKind } from './model';

/** Renders any care record type from its field description. Unsaved input survives restarts. */
export function CareForm({
  kind,
  draftKey,
  initial,
  ctx,
  creating,
  submitLabel,
  onSubmit,
}: {
  kind: CareKind;
  draftKey: string;
  initial: FormValues;
  ctx: FormContext;
  creating: boolean;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>, createOnly: Record<string, unknown>) => void;
}) {
  const t = useTheme();
  const config = CARE_FORMS[kind];
  const [values, update, clearDraft] = useDraft<FormValues>(draftKey, () => initial);
  const [error, setError] = useState<[string, string] | null>(null);

  const set = (key: string, value: string | boolean) => {
    const next = { ...values, [key]: value };
    update({ [key]: value, ...(config.onChange?.(key, next, ctx) ?? {}) });
  };
  const visible = config.fields.filter((f) => (creating || !f.createOnly) && (!f.showIf || f.showIf(values)));
  const cattleId = String(values.cattle_id ?? values.dam_id ?? '');

  function submit() {
    const problem = validate(config, values);
    setError(problem);
    if (problem) return;
    onSubmit(toBody(config, values), creating ? (config.createOnly?.(values) ?? {}) : {});
    clearDraft();
  }

  const field = (f: FieldDef) => {
    const err = error?.[0] === f.key ? error[1] : null;
    const str = typeof values[f.key] === 'string' ? (values[f.key] as string) : '';
    switch (f.type) {
      case 'text':
      case 'multiline':
        return <TextField key={f.key} label={f.label} hint={f.hint} value={str} onChangeText={(v) => set(f.key, v)} error={err} multiline={f.type === 'multiline'} />;
      case 'int':
      case 'ints':
        return <TextField key={f.key} label={f.label} hint={f.hint} value={str} onChangeText={(v) => set(f.key, v)} error={err} keyboardType={f.type === 'int' ? 'number-pad' : 'numbers-and-punctuation'} />;
      case 'date':
        return <DateField key={f.key} label={f.label} value={str || null} onChange={(v) => set(f.key, v ?? '')} error={err} allowFuture={f.allowFuture} optional={!f.required} />;
      case 'datetime':
        return <DateTimeField key={f.key} label={f.label} hint={f.hint} value={str || null} onChange={(v) => set(f.key, v ?? '')} error={err} allowFuture={f.allowFuture} optional={!f.required} />;
      case 'bool':
        return <Toggle key={f.key} label={f.label} hint={f.hint} value={!!values[f.key]} onChange={(v) => set(f.key, v)} />;
      case 'choice':
        return (
          <Fragment key={f.key}>
            <Chips label={f.label} value={str || null} options={f.options ?? []} onChange={(v) => set(f.key, v ?? '')} allowClear={!f.required} />
            {err ? <FieldError message={err} /> : null}
          </Fragment>
        );
      case 'animal':
        return (
          <Fragment key={f.key}>
            <ParentPicker label={f.label} sex={f.sex} value={str || null} animals={ctx.animals as Cattle[]} onChange={(id) => set(f.key, id ?? '')} />
            {err ? <FieldError message={err} /> : null}
          </Fragment>
        );
      case 'link': {
        // Records of the linked type for the same animal (schedules are for any animal).
        const rows = linkOptions(f.link!, ctx, cattleId);
        if (!rows.length) return null;
        return <Chips key={f.key} label={f.label} value={str || null} options={rows} onChange={(v) => set(f.key, v ?? '')} />;
      }
    }
  };

  return (
    <>
      {config.intro ? <Text style={{ color: t.textMuted, fontSize: 15 }}>{config.intro}</Text> : null}
      {error ? <Notice tone="error">{error[1]}</Notice> : null}
      {visible.map(field)}
      <Button label={submitLabel} onPress={submit} />
    </>
  );
}

function linkOptions(kind: CareKind, ctx: FormContext, cattleId: string) {
  const summary = CARE_FORMS[kind].summary;
  const rows: { id: string; cattle_id?: string; active?: boolean }[] =
    kind === 'health' ? ctx.care.health : kind === 'breeding' ? ctx.care.breeding.filter((b) => b.event_type !== 'heat_observed') : kind === 'schedule' ? ctx.care.schedules : [];
  return rows
    .filter((r) => (kind === 'schedule' ? r.active !== false : r.cattle_id === cattleId))
    .slice(0, 8)
    .map((r) => ({ value: r.id, label: summary(r, ctx) }));
}
