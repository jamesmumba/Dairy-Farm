import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { money, saleDue, toCents } from '../../finance/calc';
import { CUSTOMER_TYPES, type Customer, METHOD_LABELS } from '../../finance/model';
import { editCustomer } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDateTime } from '../../lib/dates';
import { litres } from '../../production/calc';
import { getRecord, useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { Button, FormScreen, Notice, TextField, Toggle } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { SyncBadge } from '../../ui/SyncBadge';
import { Card, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { spacing, type, useTheme } from '../../ui/theme';

export default function CustomerStatement() {
  const t = useTheme();
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const f = useFinance();
  const stored = useLocal(() => getRecord<Customer>('customers', id), id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Customer>>({});

  if (!stored) return <MissingRecord what="customer" />;
  const c = stored.data;
  const sales = f.sales.filter((s) => s.customer_id === id);
  const payments = f.payments.filter((p) => p.customer_id === id);
  const due = saleDue(sales, payments, f.allocations);
  const bal = Object.entries(f.balanceOf(id));
  const litresBought = sales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + toCents(s.quantity), 0);
  const history = [
    ...sales.map((s) => ({ kind: 'sale' as const, at: s.sale_at, row: s })),
    ...payments.map((p) => ({ kind: 'payment' as const, at: p.paid_at, row: p })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  function save() {
    if (!form.name?.trim()) return;
    const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== c[k as keyof Customer]));
    if (Object.keys(changes).length) editCustomer(stored!, changes);
    setEditing(false);
  }

  return (
    <FormScreen title={c.name} intro={[c.phone, c.address, CUSTOMER_TYPES[c.customer_type]].filter(Boolean).join(' · ')}>
      <SyncBadge state={stored.sync_state} />
      {saved ? (
        <Notice tone="success" title="Sale saved">
          {saved}. To change it, open it in the statement below.
        </Notice>
      ) : null}
      {!c.active ? <Notice>This customer is marked inactive.</Notice> : null}

      <Card gap={2}>
        <Text style={{ color: t.textMuted, ...type.secondary }}>Balance</Text>
        {bal.length === 0 ? <Text style={{ color: t.text, ...type.display }}>Nothing owed</Text> : null}
        {bal.map(([cur, v]) => (
          <Text key={cur} style={{ color: v > 0 ? t.danger : t.text, ...type.display, fontVariant: ['tabular-nums'] }}>
            {v > 0 ? `Owes ${money(v, cur)}` : v < 0 ? `In credit ${money(-v, cur)}` : `${cur}: settled`}
          </Text>
        ))}
        <Text style={{ color: t.textMuted, ...type.caption }}>
          {litres(litresBought)} L in {sales.filter((s) => s.status === 'completed').length} sales · payments clear the oldest sales first
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="New sale" onPress={() => router.push({ pathname: '/sale/new', params: { customer_id: id } })} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Payment" variant="secondary" onPress={() => router.push({ pathname: '/payment/new', params: { customer_id: id } })} />
        </View>
      </View>

      {editing ? (
        <Card>
          <TextField label="Name" value={form.name ?? ''} onChangeText={(name) => setForm((x) => ({ ...x, name }))} />
          <TextField label="Phone" value={form.phone ?? ''} onChangeText={(phone) => setForm((x) => ({ ...x, phone: phone || null }))} keyboardType="phone-pad" />
          <TextField label="Address" value={form.address ?? ''} onChangeText={(address) => setForm((x) => ({ ...x, address: address || null }))} />
          <Chips label="Type" value={form.customer_type ?? c.customer_type} options={Object.entries(CUSTOMER_TYPES).map(([value, label]) => ({ value: value as Customer['customer_type'], label }))} onChange={(v) => v && setForm((x) => ({ ...x, customer_type: v }))} allowClear={false} />
          <TextField label="Notes" value={form.notes ?? ''} onChangeText={(notes) => setForm((x) => ({ ...x, notes: notes || null }))} multiline />
          <Toggle label="Active customer" value={form.active ?? c.active} onChange={(active) => setForm((x) => ({ ...x, active }))} />
          <Button label="Save" onPress={save} />
          <Button label="Cancel" variant="link" onPress={() => setEditing(false)} />
        </Card>
      ) : null}

      <SectionHeader
        title="Statement"
        action={editing ? undefined : 'Edit customer'}
        onAction={() => {
          setForm({ name: c.name, phone: c.phone, address: c.address, customer_type: c.customer_type, notes: c.notes, active: c.active });
          setEditing(true);
        }}
      />
      {history.length === 0 ? <Text style={{ color: t.textMuted, ...type.bodySmall }}>No sales or payments yet.</Text> : null}
      {history.length ? (
        <ListGroup>
          {history.map(({ kind, row }) => {
            const synced = getRecord(kind === 'sale' ? 'milk_sales' : 'payments', row.id)?.sync_state ?? 'synced';
            const voided = row.status === 'voided';
            const when = formatDateTime(kind === 'sale' ? (row as { sale_at: string }).sale_at : (row as { paid_at: string }).paid_at);
            const owing = kind === 'sale' && !voided ? due.get(row.id) : 0;
            const status = voided ? 'voided' : kind === 'sale' ? (owing ? `due ${money(owing, row.currency)}` : 'paid') : METHOD_LABELS[(row as { method: keyof typeof METHOD_LABELS }).method];
            const title =
              kind === 'sale'
                ? `${(row as { quantity: string }).quantity} L sold`
                : { payment: 'Payment', refund: 'Refund', adjustment: 'Adjustment' }[(row as { kind: 'payment' | 'refund' | 'adjustment' }).kind];
            const amount = money(toCents(kind === 'sale' ? (row as { total: string }).total : (row as { amount: string }).amount), row.currency);
            return (
              <View key={`${kind}:${row.id}`} style={{ opacity: voided ? 0.55 : 1 }}>
                <ListRow
                  icon={kind === 'sale' ? 'water-outline' : 'cash-plus'}
                  tint={owing ? 'straw' : 'green'}
                  title={title}
                  subtitle={`${when} · ${status}${synced !== 'synced' ? ' · waiting to sync' : ''}`}
                  value={`${kind === 'sale' ? '' : '− '}${amount}`}
                  href={{ pathname: kind === 'sale' ? '/sale/[id]' : '/payment/[id]', params: { id: row.id } }}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
    </FormScreen>
  );
}
