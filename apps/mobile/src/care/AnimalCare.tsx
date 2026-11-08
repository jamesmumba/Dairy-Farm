import { type Href, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { Cattle } from '../animals/model';
import { formatDate, formatDateTime, toDateString } from '../lib/dates';
import { Button, Notice } from '../ui/form';
import { Card, type IconName, ListGroup, ListRow } from '../ui/kit';
import { spacing, type, useCardBasis, useTheme } from '../ui/theme';
import { useOpenOrBack } from '../ui/useOpenOrBack';
import { CARE_FORMS } from './forms';
import { activeWithdrawal, CARE_KINDS, type CareData, type CareKind, RESULT_LABELS, underTreatment } from './model';

/** Prominent notice while the vet's withdrawal end time has not been reached. Opens the treatment. */
export function WithdrawalBanner({ care, cattleId }: { care: CareData; cattleId: string }) {
  const open = useOpenOrBack();
  const w = activeWithdrawal(care.treatments, cattleId);
  if (!w) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens the treatment" onPress={() => open({ pathname: '/care/[kind]/[id]', params: { kind: 'treatment', id: w.id } })}>
      <Notice tone="error" title={`Milk withdrawal until ${formatDateTime(w.withdrawal_ends_at)}`}>
        {w.medication}. Not for sale or drinking until then, even if the treatment has finished. Tap to open the treatment.
      </Notice>
    </Pressable>
  );
}

const dateOf = (kind: CareKind, r: Record<string, any>): string =>
  ({
    health: r.reported_on,
    'vet-visit': r.visit_at,
    treatment: r.started_on,
    breeding: r.event_at,
    'pregnancy-check': r.examined_on ?? r.scheduled_on,
    calving: r.calved_on,
    vaccination: r.administered_on ?? r.due_on,
    schedule: '',
    action: r.action_on,
  })[kind] ?? '';

export const KIND_ICON: Partial<Record<CareKind, IconName>> = {
  health: 'stethoscope',
  treatment: 'pill',
  'vet-visit': 'medical-bag',
  breeding: 'heart-outline',
  'pregnancy-check': 'heart-pulse',
  calving: 'cow',
  vaccination: 'needle',
  action: 'clipboard-check-outline',
  schedule: 'calendar-check',
};

export function AnimalCare({ animal, care, showAdd = true }: { animal: Cattle; care: CareData; showAdd?: boolean }) {
  const t = useTheme();
  const basis = useCardBasis();
  const id = animal.id;
  const today = toDateString(new Date());
  const female = animal.sex === 'female';
  const mine = <T extends { cattle_id?: string; dam_id?: string }>(rows: T[]) => rows.filter((r) => (r.cattle_id ?? r.dam_id) === id);

  const openHealth = mine(care.health).filter((h) => ['ongoing', 'recovering', 'chronic'].includes(h.recovery_status));
  const pendingCheck = mine(care.checks).filter((c) => c.result === 'pending').sort((a, b) => (a.scheduled_on ?? '').localeCompare(b.scheduled_on ?? ''))[0];
  const lastPregnant = mine(care.checks)
    .filter((c) => c.result === 'pregnant')
    .sort((a, b) => (b.examined_on ?? '').localeCompare(a.examined_on ?? ''))[0];
  const nextVaccine = mine(care.vaccinations)
    .filter((v) => v.status === 'scheduled' && v.due_on)
    .sort((a, b) => a.due_on!.localeCompare(b.due_on!))[0];

  const lines: { text: string; tone?: 'danger' }[] = [];
  if (underTreatment(care.treatments, id, today)) lines.push({ text: 'Under treatment', tone: 'danger' });
  for (const h of openHealth) {
    lines.push({ text: `${h.urgent ? '⚠ Urgent: ' : ''}${h.confirmed_diagnosis ?? h.suspected_issue ?? 'Health concern'} (${h.recovery_status})`, tone: h.urgent ? 'danger' : undefined });
  }
  if (female && pendingCheck) lines.push({ text: `Pregnancy check ${pendingCheck.scheduled_on && pendingCheck.scheduled_on < today ? 'overdue since' : 'due'} ${formatDate(pendingCheck.scheduled_on)}` });
  if (female && lastPregnant?.expected_calving_on) lines.push({ text: `Pregnant · calving expected ${formatDate(lastPregnant.expected_calving_on)}` });
  if (nextVaccine) lines.push({ text: `${nextVaccine.vaccine_name} ${nextVaccine.due_on! < today ? 'overdue since' : 'due'} ${formatDate(nextVaccine.due_on)}`, tone: nextVaccine.due_on! < today ? 'danger' : undefined });

  const records = (Object.keys(CARE_KINDS) as CareKind[])
    .filter((k) => k !== 'schedule')
    .flatMap((k) => {
      const list = { health: care.health, 'vet-visit': care.visits, treatment: care.treatments, breeding: care.breeding, 'pregnancy-check': care.checks, calving: care.calvings, vaccination: care.vaccinations, action: care.actions }[k as Exclude<CareKind, 'schedule'>];
      return mine(list as { cattle_id?: string; dam_id?: string; id: string }[]).map((r) => ({ kind: k, row: r as Record<string, any> }));
    })
    .sort((a, b) => dateOf(b.kind, b.row).localeCompare(dateOf(a.kind, a.row)))
    .slice(0, 12);

  const add = (kind: CareKind, label: string) => (
    <View style={{ flexBasis: basis, flexGrow: 1 }} key={kind}>
      <Button label={label} variant="secondary" onPress={() => router.push({ pathname: '/care/[kind]/new', params: { kind, cattle_id: id } } as Href)} />
    </View>
  );

  return (
    <View style={{ gap: spacing.sm }}>
      <Card gap={spacing.sm}>
        {lines.length ? (
          lines.map((l) => (
            <Text key={l.text} style={{ color: l.tone === 'danger' ? t.danger : t.text, ...type.bodySmall }}>
              {l.text}
            </Text>
          ))
        ) : (
          <Text style={{ color: t.textMuted, ...type.bodySmall }}>No open health concerns or upcoming care.</Text>
        )}
        {female && animal.reproductive_status === 'bred' && !pendingCheck ? (
          <Text style={{ color: t.textMuted, ...type.caption }}>Bred: not pregnant until a pregnancy check confirms it.</Text>
        ) : null}
      </Card>

      {showAdd ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {add('health', 'Health concern')}
        {add('treatment', 'Treatment')}
        {add('vet-visit', 'Vet visit')}
        {add('vaccination', 'Vaccination')}
        {female ? add('breeding', 'Heat or breeding') : null}
        {female ? add('pregnancy-check', 'Pregnancy check') : null}
        {female ? add('calving', 'Calving') : null}
      </View> : null}

      {records.length ? (
        <ListGroup>
          {records.map(({ kind, row }) => (
            <ListRow
              key={`${kind}:${row.id}`}
              icon={KIND_ICON[kind] ?? 'clipboard-text-outline'}
              title={CARE_FORMS[kind].summary(row, { care })}
              subtitle={`${CARE_KINDS[kind].label} · ${formatDate(String(dateOf(kind, row)).slice(0, 10))}`}
              href={{ pathname: '/care/[kind]/[id]', params: { kind, id: row.id } } as Href}
            />
          ))}
        </ListGroup>
      ) : null}
      {female && lastPregnant ? <Text style={{ color: t.textMuted, ...type.caption }}>Pregnancy status: {RESULT_LABELS[lastPregnant.result]} on {formatDate(lastPregnant.examined_on)}.</Text> : null}
    </View>
  );
}
