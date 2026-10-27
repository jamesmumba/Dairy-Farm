import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { displayName } from '../animals/model';
import type { Breed, Cattle } from '../animals/model';
import { api, NetworkError } from '../lib/api';
import { litres, toCl } from '../production/calc';
import { CARE_KINDS, kindOfEntity } from '../care/model';
import { correctMilk, type MilkEntry } from '../production/repo';
import { runSync } from '../sync/engine';
import { applyServerRow, discardChanges, failedOps, getRecord, type Op, removeRecord, requeue, useLocal } from '../sync/store';
import type { Customer } from '../finance/model';
import { Button, Notice } from '../ui/form';
import { radius, shadow, spacing, useTheme } from '../ui/theme';

const KIND_LABELS: Record<Op['kind'], string> = {
  create: 'New record',
  update: 'Edit',
  status: 'Status change',
  delete: 'Deletion',
  photo: 'Photo',
  correct: 'Correction',
  void: 'Void',
};

function animalName(id: string | undefined) {
  const a = id ? getRecord<Cattle>('cattle', id)?.data : undefined;
  return a ? displayName(a) : 'Animal';
}

function recordName(op: Op) {
  const care = kindOfEntity(op.entity);
  if (care) {
    const r = getRecord<{ cattle_id?: string; dam_id?: string }>(op.entity, op.record_id)?.data;
    return `${CARE_KINDS[care].label}${r && (r.cattle_id ?? r.dam_id) ? ` for ${animalName(r.cattle_id ?? r.dam_id)}` : ''}`;
  }
  if (op.entity === 'milk_production') {
    const m = getRecord<MilkEntry>('milk_production', op.record_id)?.data;
    return m ? `${animalName(m.cattle_id)}, ${m.session} ${m.production_date}, ${litres(toCl(m.quantity))} L` : 'Milk entry';
  }
  if (op.entity === 'cattle') {
    const a = getRecord<Cattle>('cattle', op.record_id)?.data;
    return a ? displayName(a) : 'Animal';
  }
  const finance = FINANCE_NAMES[op.entity];
  if (finance) {
    const r = getRecord<{ customer_id?: string; total?: string; amount?: string; currency?: string; name?: string; quantity?: string }>(op.entity, op.record_id)?.data;
    const who = r?.customer_id ? getRecord<Customer>('customers', r.customer_id)?.data.name : r?.name;
    const what = r?.total ?? r?.amount ? `${r?.currency} ${r?.total ?? r?.amount}` : r?.quantity ? `${r.quantity.replace('-', '')} L` : '';
    return [finance, who, what].filter(Boolean).join(' · ');
  }
  return `Breed ${getRecord<Breed>('cattle_breeds', op.record_id)?.data.name ?? ''}`;
}

const FINANCE_NAMES: Record<string, string> = {
  customers: 'Customer',
  milk_prices: 'Milk price',
  milk_sales: 'Sale',
  payments: 'Payment',
  milk_stock_movements: 'Stock record',
  farm_expenses: 'Expense',
};
const FINANCE_LISTS: Record<string, string> = { customers: '/v1/customers', milk_sales: '/v1/milk-sales', payments: '/v1/payments', farm_expenses: '/v1/expenses' };

/** The server's current copy, to restore when the farmer discards their change. */
async function serverCopy(op: Op): Promise<{ id: string } | null> {
  if (op.kind === 'create') return null;
  if (op.entity === 'cattle') return api(`/v1/cattle/${op.record_id}`);
  const care = kindOfEntity(op.entity);
  if (care) {
    const rows = await api<{ id: string }[]>(`/v1/${CARE_KINDS[care].path}`);
    return rows.find((r) => r.id === op.record_id) ?? null;
  }
  if (op.entity === 'milk_production') {
    const rows = await api<MilkEntry[]>('/v1/milk-production');
    return rows.find((r) => r.id === op.record_id) ?? null;
  }
  if (FINANCE_LISTS[op.entity]) {
    const rows = await api<{ id: string }[]>(FINANCE_LISTS[op.entity]);
    return rows.find((r) => r.id === op.record_id) ?? null;
  }
  const breeds = await api<Breed[]>('/v1/breeds');
  return breeds.find((b) => b.id === op.record_id) ?? null;
}

function Differences({ mine, saved }: { mine: Record<string, unknown>; saved: Record<string, unknown> }) {
  const t = useTheme();
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : String(v));
  const keys = Object.keys(mine).filter((k) => show(mine[k]) !== show(saved[k]));
  if (!keys.length) return <Text style={{ color: t.textMuted }}>No field differences.</Text>;
  return (
    <View style={{ gap: 4 }}>
      {keys.map((k) => (
        <Text key={k} style={{ color: t.text, fontSize: 15 }}>
          {k.replace(/_/g, ' ')}: yours “{show(mine[k])}”, saved “{show(saved[k])}”
        </Text>
      ))}
    </View>
  );
}

function Issue({ op }: { op: Op }) {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  const body = (op.error_body ? JSON.parse(op.error_body) : {}) as { current?: { id: string; version: number } & Record<string, unknown> };
  const mine = (op.body ? JSON.parse(op.body) : {}) as Record<string, unknown>;
  const conflict = op.error_code === 'version_conflict' && body.current;
  const existing = op.error_code === 'session_exists' ? (body as { existing?: MilkEntry }).existing : undefined;
  const fixable = op.entity === 'cattle' && ['ear_tag_taken', 'validation_failed'].includes(op.error_code ?? '');

  async function discard() {
    setError(null);
    try {
      discardChanges(op.entity, op.record_id, conflict ? body.current! : await serverCopy(op));
      // A discarded sale correction also drops the corrected sale shown in its place.
      if (op.entity === 'milk_sales' && op.kind === 'correct' && typeof mine.new_id === 'string') removeRecord('milk_sales', mine.new_id);
    } catch (err) {
      setError(err instanceof NetworkError ? 'Connect to the internet to restore the saved version.' : 'Could not load the saved version.');
    }
  }

  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.card, ...shadow, padding: spacing.md, gap: spacing.sm }}>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>
        {KIND_LABELS[op.kind]}: {recordName(op)}
      </Text>
      <Text style={{ color: t.danger, fontSize: 15 }}>⚠ {op.error_message}</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {existing ? (
        <>
          <Text style={{ color: t.textMuted, fontSize: 15 }}>
            This session was already recorded (perhaps on another phone) as {litres(toCl(existing.quantity))} L. This phone has{' '}
            {mine.quantity ? `${litres(toCl(String(mine.quantity)))} L` : 'a different value'}.
          </Text>
          <Button label="Keep the saved value" onPress={() => discardChanges(op.entity, op.record_id, null)} />
          <Button
            label="Replace it with this phone’s value"
            variant="secondary"
            onPress={() => {
              discardChanges(op.entity, op.record_id, null);
              applyServerRow('milk_production', existing);
              const saved = getRecord<MilkEntry>('milk_production', existing.id)!;
              correctMilk(saved, { quantity: String(mine.quantity) }, 'Replaced with the entry made on another phone');
            }}
          />
        </>
      ) : conflict ? (
        <>
          <Text style={{ color: t.textMuted, fontSize: 15 }}>This record was changed on another device. Choose which version to keep.</Text>
          <Differences mine={mine} saved={body.current!} />
          <Button
            label="Keep my version"
            onPress={() => {
              requeue(op, body.current!.version);
              void runSync();
            }}
          />
          <Button label="Use the saved version" variant="secondary" onPress={discard} />
        </>
      ) : (
        <>
          {fixable ? (
            <Button
              label="Fix and try again"
              hint="Opens the record; saving it sends the change again"
              onPress={() => router.push({ pathname: '/animal/[id]/edit', params: { id: op.record_id } } as Href)}
            />
          ) : null}
          {op.error_code === 'insufficient_stock' ? (
            <Button
              label="Make a stock adjustment"
              hint="Then try again"
              onPress={() => router.push({ pathname: '/stock/new', params: { kind: 'adjustment', date: String((body as { date?: string }).date ?? '') } } as Href)}
            />
          ) : null}
          {op.error_code === 'has_history' ? (
            <Button label="Change status instead" onPress={() => router.push({ pathname: '/animal/[id]/status', params: { id: op.record_id } } as Href)} />
          ) : null}
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => {
              requeue(op);
              void runSync();
            }}
          />
          <Button label={op.kind === 'create' ? 'Delete this unsaved record' : 'Discard my change'} variant="link" onPress={discard} />
        </>
      )}
    </View>
  );
}

export default function SyncIssues() {
  const t = useTheme();
  const ops = useLocal(failedOps);
  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      {ops.length === 0 ? (
        <Notice tone="success" title="All saved">
          Everything on this phone has been saved to your account.
        </Notice>
      ) : (
        <Text style={{ color: t.textMuted, fontSize: 14 }}>Saved on this phone, but your account did not accept them. Nothing is lost until you discard it.</Text>
      )}
      {ops.map((op) => (
        <Issue key={op.op_id} op={op} />
      ))}
    </ScrollView>
  );
}
