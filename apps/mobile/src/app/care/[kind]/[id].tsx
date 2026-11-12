import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { displayName } from '../../../animals/model';
import { listAnimals } from '../../../animals/repo';
import { KIND_ICON } from '../../../care/AnimalCare';
import { CareForm } from '../../../care/CareForm';
import { CARE_FORMS, fromRecord } from '../../../care/forms';
import { type QuickAction, recordActions } from '../../../care/quick';
import { QuickButtons, useQuickActions } from '../../../care/QuickActions';
import { CARE_KINDS, type CareKind, type Treatment } from '../../../care/model';
import { milkHeldBack, relatedRecords, storyOf } from '../../../care/related';
import { COST_CATEGORY, expensesFor, totalCost } from '../../../care/costs';
import { money, toCents } from '../../../finance/calc';
import { listMilk } from '../../../production/repo';
import { L } from '../../../production/format';
import { getCare, listCare, removeCare, updateCare } from '../../../care/repo';
import { useCareContext } from '../../../care/useCareContext';
import { formatDate, formatDateTime } from '../../../lib/dates';
import { useLocal } from '../../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../../ui/form';
import { MissingRecord } from '../../../ui/ProblemView';
import { SyncBadge } from '../../../ui/SyncBadge';
import { Card, Details, FormCard, Hero, ListGroup, ListRow } from '../../../ui/kit';
import { type, useTheme } from '../../../ui/theme';
import { useOpenOrBack } from '../../../ui/useOpenOrBack';

type Row = { id: string; version: number; deleted_at: string | null } & Record<string, unknown>;

/** The question the record is waiting on, above its answers. */
const promptFor = (kind: CareKind, actions: QuickAction[]) =>
  actions[0] === 'record_calving'
    ? 'Has she calved?'
    : kind === 'vaccination'
      ? 'Was this dose given?'
      : kind === 'treatment'
        ? 'Update the treatment'
        : kind === 'pregnancy-check'
          ? 'What was the result?'
          : 'How is she now?';

export default function CareRecord() {
  const open = useOpenOrBack();
  const t = useTheme();
  const { kind, id } = useLocalSearchParams<{ kind: CareKind; id: string }>();
  const ctx = useCareContext();
  const allAnimals = useLocal(() => listAnimals().map((a) => a.data));
  const record = useLocal(() => (kind in CARE_KINDS ? getCare<Row>(kind, id) : null), `${kind}:${id}`);
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const quick = useQuickActions();

  if (!record) return <MissingRecord what="record" />;
  const config = CARE_FORMS[kind];
  const r = record.data;
  const animalId = (r.cattle_id ?? r.dam_id) as string | undefined;
  const animal = allAnimals.find((a) => a.id === animalId);
  const treatment = kind === 'treatment' ? (r as unknown as Treatment) : null;
  const actions = recordActions(kind, r, ctx, new Date());
  // Records that belong with this one, both ways (a concern and its treatments, a mating and its check).
  const related = relatedRecords(kind, r, ctx.care).flatMap((x) => {
    const row = listCare<Row>(x.kind).find((c) => c.data.id === x.id)?.data;
    return row ? [{ ...x, subtitle: CARE_FORMS[x.kind].summary(row, ctx) }] : [];
  });
  const calf = kind === 'calving' && r.calf_id ? allAnimals.find((a) => a.id === r.calf_id) : undefined;
  // Costs: this record's own, and for a health concern the whole case (its visits and treatments too).
  const costKind = COST_CATEGORY[kind] ? kind : null;
  const ownCosts = costKind ? expensesFor([id]) : [];
  const caseCosts = kind === 'health' ? expensesFor(storyOf(kind, id, ctx.care).map((x) => x.id)) : ownCosts;
  const held = treatment?.requires_milk_withdrawal ? milkHeldBack(treatment, ctx.care.treatments, listMilk().map((m) => m.data)) : null;

  const show = (key: string, type: string): string | null => {
    const v = r[key];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null;
    if (type === 'bool') return v ? 'Yes' : 'No';
    if (type === 'date') return formatDate(String(v));
    if (type === 'datetime') return formatDateTime(String(v));
    if (type === 'choice') return config.fields.find((f) => f.key === key)?.options?.find((o) => o.value === v)?.label ?? String(v);
    if (type === 'animal') {
      const a = allAnimals.find((x) => x.id === v);
      return a ? displayName(a) : null;
    }
    if (type === 'link') return null;
    return Array.isArray(v) ? v.join(', ') : String(v);
  };

  function remove() {
    if (reason.trim().length < 3) return setError('Say why this record is being removed.');
    Alert.alert('Remove this record?', 'It is kept in the history with your reason but no longer counts anywhere.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeCare(kind, record!, reason.trim());
          router.back();
        },
      },
    ]);
  }

  return (
    <FormScreen title={CARE_KINDS[kind].label}>
      <Hero label={animal ? displayName(animal) : CARE_KINDS[kind].label} value={config.summary(r, ctx)} />
      <SyncBadge state={record.sync_state} />
      {r.version === 0 ? <Text style={{ color: t.textMuted, ...type.caption }}>Status changes, scheduled checks and milk re-checks appear after this syncs.</Text> : null}
      {treatment?.milk_entries_rechecked ? (
        <Notice>{treatment.milk_entries_rechecked} milk entr{treatment.milk_entries_rechecked === 1 ? 'y was' : 'ies were'} re-checked against this withdrawal and updated.</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {mode === 'edit' ? (
        <FormCard>
          <CareForm
            kind={kind}
            draftKey={`care-edit-${kind}-${id}`}
            initial={fromRecord(config, r)}
            ctx={ctx}
            creating={false}
            submitLabel="Save changes"
            onSubmit={(body) => {
              const changes = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(r[k] ?? null)));
              if (Object.keys(changes).length) updateCare(kind, record, changes);
              setMode('view');
            }}
          />
        </FormCard>
      ) : (
        <>
          {actions.length && mode === 'view' ? (
            <Card>
              <Text style={{ color: t.text, ...type.input, fontWeight: '600' }}>{promptFor(kind, actions)}</Text>
              <QuickButtons actions={actions} onPick={(a) => quick.start(a, { kind, id })} />
            </Card>
          ) : null}
          <Details
            rows={config.fields
              .filter((f) => !f.createOnly)
              .map((f) => [f.label, show(f.key, f.type)] as [string, string | null])}
          />
          {mode === 'remove' ? (
            <FormCard title="Remove this record">
              <TextField label="Why?" hint="For records entered by mistake" value={reason} onChangeText={setReason} />
              <Button label="Remove record" variant="danger" onPress={remove} />
              <Button label="Cancel" variant="text" onPress={() => setMode('view')} />
            </FormCard>
          ) : (
            <ListGroup>
              {kind === 'health' && animal
                ? [
                    <ListRow key="treatment" icon="pill" title="Add treatment" subtitle="Linked to this concern" onPress={() => router.push({ pathname: '/care/[kind]/new', params: { kind: 'treatment', cattle_id: animal.id, health_record_id: id } })} />,
                    <ListRow key="visit" icon="medical-bag" title="Add vet visit" subtitle="Linked to this concern" onPress={() => router.push({ pathname: '/care/[kind]/new', params: { kind: 'vet-visit', cattle_id: animal.id, health_record_id: id } })} />,
                  ]
                : null}
              {related.map((x) => (
                <ListRow key={x.id} icon={KIND_ICON[x.kind]} title={x.title} subtitle={x.subtitle} onPress={() => open({ pathname: '/care/[kind]/[id]', params: { kind: x.kind, id: x.id } })} />
              ))}
              {held && held.milkings ? (
                <ListRow
                  icon="water-off-outline"
                  tint="red"
                  title={`Milk held back: ${L(Math.round(held.litres * 100))}`}
                  subtitle={`${held.milkings} milking${held.milkings === 1 ? '' : 's'} kept out of stock by this withdrawal`}
                  onPress={() => animal && open({ pathname: '/animal/[id]', params: { id: animal.id, section: 'milk' } })}
                />
              ) : null}
              {kind === 'action' && !r.health_record_id && animal ? (
                <ListRow
                  icon="stethoscope"
                  title="Record a health concern"
                  subtitle="Linked to this action"
                  onPress={() => router.push({ pathname: '/care/[kind]/new', params: { kind: 'health', cattle_id: animal.id, from_action: id } })}
                />
              ) : null}
              {ownCosts.map((e) => (
                <ListRow key={e.id} icon="receipt" title={`Cost: ${money(toCents(e.amount), e.currency)}`} subtitle={e.payee ?? undefined} onPress={() => open({ pathname: '/expenses/[id]', params: { id: e.id } })} />
              ))}
              {kind === 'health' && caseCosts.length > ownCosts.length ? (
                <ListRow
                  icon="calculator-variant-outline"
                  title={`Cost of this case: ${totalCost(caseCosts).map(([cur, c]) => money(c, cur)).join(', ')}`}
                  subtitle="This concern, its vet visits and treatments"
                />
              ) : null}
              {costKind ? (
                <ListRow
                  icon="cash-plus"
                  title="Add a cost"
                  subtitle="An expense for this record"
                  onPress={() => router.push({ pathname: '/expenses/new', params: { care_kind: kind, care_id: id, category: COST_CATEGORY[kind] } })}
                />
              ) : null}
              {calf ? <ListRow icon="cow" title={`Calf: ${displayName(calf)}`} subtitle="Open the calf" onPress={() => open({ pathname: '/animal/[id]', params: { id: calf.id } })} /> : null}
              {animal ? <ListRow icon="cow" title={displayName(animal)} subtitle="Open the animal" onPress={() => open({ pathname: '/animal/[id]', params: { id: animal.id } })} /> : null}
              <ListRow icon="pencil-outline" title="Edit" onPress={() => setMode('edit')} />
              <ListRow icon="delete-outline" tint="red" title="Remove" subtitle="Only if entered by mistake" onPress={() => setMode('remove')} />
            </ListGroup>
          )}
        </>
      )}
      {quick.sheet}
    </FormScreen>
  );
}
