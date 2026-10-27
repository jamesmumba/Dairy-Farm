import { type Href, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { Cattle } from '../animals/model';
import { formatDate, formatDateTime, toDateString } from '../lib/dates';
import { Button, Notice } from '../ui/form';
import { minTouch, spacing, useTheme, useCardBasis } from '../ui/theme';
import { CARE_FORMS } from './forms';
import { activeWithdrawal, CARE_KINDS, type CareData, type CareKind, RESULT_LABELS, underTreatment } from './model';

/** Prominent notice while the vet's withdrawal end time has not been reached. */
export function WithdrawalBanner({ care, cattleId }: { care: CareData; cattleId: string }) {
  const w = activeWithdrawal(care.treatments, cattleId);
  if (!w) return null;
  return (
    <Notice tone="error">
      ⚠ Milk withdrawal until {formatDateTime(w.withdrawal_ends_at)} ({w.medication}). Milk from this cow is not for sale or human consumption until then,
      even if the treatment has finished.
    </Notice>
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
  })[kind] ?? '';

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
      const list = { health: care.health, 'vet-visit': care.visits, treatment: care.treatments, breeding: care.breeding, 'pregnancy-check': care.checks, calving: care.calvings, vaccination: care.vaccinations }[k as Exclude<CareKind, 'schedule'>];
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
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        Health and care
      </Text>
      {lines.length ? (
        lines.map((l) => (
          <Text key={l.text} style={{ color: l.tone === 'danger' ? t.danger : t.text, fontSize: 16 }}>
            {l.text}
          </Text>
        ))
      ) : (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>No open health concerns or upcoming care.</Text>
      )}
      {female && animal.reproductive_status === 'bred' && !pendingCheck ? (
        <Text style={{ color: t.textMuted, fontSize: 14 }}>Bred: not pregnant until a pregnancy check confirms it.</Text>
      ) : null}

      {showAdd ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {add('health', 'Health concern')}
        {add('treatment', 'Treatment')}
        {add('vet-visit', 'Vet visit')}
        {add('vaccination', 'Vaccination')}
        {female ? add('breeding', 'Heat or breeding') : null}
        {female ? add('pregnancy-check', 'Pregnancy check') : null}
        {female ? add('calving', 'Calving') : null}
      </View> : null}

      {records.map(({ kind, row }) => (
        <Pressable
          key={`${kind}:${row.id}`}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/care/[kind]/[id]', params: { kind, id: row.id } } as Href)}
          style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border }}
        >
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            {CARE_KINDS[kind].label} · {formatDate(String(dateOf(kind, row)).slice(0, 10))}
          </Text>
          <Text style={{ color: t.text, fontSize: 16 }}>{CARE_FORMS[kind].summary(row, { care })}</Text>
        </Pressable>
      ))}
      {female && lastPregnant ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Pregnancy status: {RESULT_LABELS[lastPregnant.result]} on {formatDate(lastPregnant.examined_on)}.</Text> : null}
    </View>
  );
}
