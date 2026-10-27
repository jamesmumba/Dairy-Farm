import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { money, saleDue, toCents } from '../../finance/calc';
import { CUSTOMER_TYPES, type Customer, METHOD_LABELS } from '../../finance/model';
import { editCustomer } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDateTime } from '../../lib/dates';
import { litres } from '../../production/calc';
import { getRecord, useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { Button, FormScreen, Notice, TextField, Toggle } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { minTouch, radius, spacing, useTheme } from '../../ui/theme';

export default function CustomerStatement() {
  const t = useTheme();
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const f = useFinance();
  const stored = useLocal(() => getRecord<Customer>('customers', id), id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Customer>>({});

  if (!stored) return <FormScreen title="Customer"><Notice tone="error">This customer is not on this phone.</Notice></FormScreen>;
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
          {saved}. Saved on this phone; your account confirms the price, payment and stock when it syncs. To change it, open the sale below.
        </Notice>
      ) : null}
      {!c.active ? <Notice>This customer is marked inactive.</Notice> : null}

      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, padding: spacing.md, gap: 4 }} accessible>
        <Text style={{ color: t.textMuted, fontSize: 14 }}>Balance</Text>
        {bal.length === 0 ? <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>Nothing owed</Text> : null}
        {bal.map(([cur, v]) => (
          <Text key={cur} style={{ color: v > 0 ? t.danger : t.text, fontSize: 20, fontWeight: '700' }}>
            {v > 0 ? `Owes ${money(v, cur)}` : v < 0 ? `In credit ${money(-v, cur)}` : `${cur}: settled`}
          </Text>
        ))}
        <Text style={{ color: t.textMuted, fontSize: 14 }}>
          {litres(litresBought)} L bought in {sales.filter((s) => s.status === 'completed').length} sale(s). Payments are applied to the oldest sales first; anything extra is kept as credit.
        </Text>
      </View>

      <Button label="New sale" onPress={() => router.push({ pathname: '/sale/new', params: { customer_id: id } })} />
      <Button label="Record a payment" variant="secondary" onPress={() => router.push({ pathname: '/payment/new', params: { customer_id: id } })} />

      {editing ? (
        <>
          <TextField label="Name" value={form.name ?? ''} onChangeText={(name) => setForm((x) => ({ ...x, name }))} />
          <TextField label="Phone" value={form.phone ?? ''} onChangeText={(phone) => setForm((x) => ({ ...x, phone: phone || null }))} keyboardType="phone-pad" />
          <TextField label="Address" value={form.address ?? ''} onChangeText={(address) => setForm((x) => ({ ...x, address: address || null }))} />
          <Chips label="Type" value={form.customer_type ?? c.customer_type} options={Object.entries(CUSTOMER_TYPES).map(([value, label]) => ({ value: value as Customer['customer_type'], label }))} onChange={(v) => v && setForm((x) => ({ ...x, customer_type: v }))} allowClear={false} />
          <TextField label="Notes" value={form.notes ?? ''} onChangeText={(notes) => setForm((x) => ({ ...x, notes: notes || null }))} multiline />
          <Toggle label="Active customer" value={form.active ?? c.active} onChange={(active) => setForm((x) => ({ ...x, active }))} />
          <Button label="Save" onPress={save} />
          <Button label="Cancel" variant="link" onPress={() => setEditing(false)} />
        </>
      ) : (
        <Button
          label="Edit customer"
          variant="link"
          onPress={() => {
            setForm({ name: c.name, phone: c.phone, address: c.address, customer_type: c.customer_type, notes: c.notes, active: c.active });
            setEditing(true);
          }}
        />
      )}

      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        Statement
      </Text>
      {history.length === 0 ? <Text style={{ color: t.textMuted }}>No sales or payments yet.</Text> : null}
      {history.map(({ kind, row }) => {
        const synced = getRecord(kind === 'sale' ? 'milk_sales' : 'payments', row.id)?.sync_state ?? 'synced';
        const voided = row.status === 'voided';
        return (
          <Pressable
            key={`${kind}:${row.id}`}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: kind === 'sale' ? '/sale/[id]' : '/payment/[id]', params: { id: row.id } })}
            style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 4, opacity: voided ? 0.6 : 1 }}
          >
            <Text style={{ color: t.textMuted, fontSize: 13 }}>{formatDateTime(kind === 'sale' ? (row as { sale_at: string }).sale_at : (row as { paid_at: string }).paid_at)}</Text>
            {kind === 'sale' ? (
              <Text style={{ color: t.text, fontSize: 16, textDecorationLine: voided ? 'line-through' : 'none' }}>
                Sale: {(row as { quantity: string }).quantity} L × {(row as { price_per_litre: string }).price_per_litre} = {money(toCents((row as { total: string }).total), row.currency)}
                {!voided ? ` · ${due.get(row.id) ? `due ${money(due.get(row.id)!, row.currency)}` : 'paid'}` : ' · voided'}
              </Text>
            ) : (
              <Text style={{ color: t.text, fontSize: 16, textDecorationLine: voided ? 'line-through' : 'none' }}>
                {{ payment: 'Payment', refund: 'Refund', adjustment: 'Adjustment' }[(row as { kind: 'payment' | 'refund' | 'adjustment' }).kind]}: {money(toCents((row as { amount: string }).amount), row.currency)} ·{' '}
                {METHOD_LABELS[(row as { method: keyof typeof METHOD_LABELS }).method]}
                {voided ? ' · voided' : ''}
              </Text>
            )}
            <SyncBadge state={synced} />
          </Pressable>
        );
      })}
    </FormScreen>
  );
}
