import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { fromCents, listPrice, money, saleTotal, toCents } from '../../finance/calc';
import { METHOD_LABELS, type Method } from '../../finance/model';
import { recordSale } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { CURRENCIES } from '../../lib/account';
import { litres } from '../../production/calc';
import { Chips } from '../../ui/Chips';
import { DateTimeField } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField, Toggle } from '../../ui/form';
import { radius, shadow, spacing, useTheme } from '../../ui/theme';

const QUICK = ['1', '2', '5', '10', '20'];
const decimal = (s: string, digits: number) => new RegExp(`^\\d{1,${digits}}([.,]\\d{1,2})?$`).test(s.trim());
const norm = (s: string) => s.trim().replace(',', '.');

export default function NewSale() {
  const t = useTheme();
  const params = useLocalSearchParams<{ customer_id?: string }>();
  const f = useFinance();
  const [customerId, setCustomerId] = useState<string | null>(params.customer_id ?? null);
  // A customer added from this form comes back here already chosen.
  const [seenCustomerParam, setSeenCustomerParam] = useState(params.customer_id);
  if (params.customer_id !== seenCustomerParam) {
    setSeenCustomerParam(params.customer_id);
    if (params.customer_id) setCustomerId(params.customer_id);
  }
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState<string | null>('1');
  const [other, setOther] = useState('');
  const [saleAt, setSaleAt] = useState(new Date().toISOString());
  const [currency, setCurrency] = useState(f.currency);
  const [override, setOverride] = useState(false);
  const [price, setPrice] = useState('');
  const [paidChoice, setPaidChoice] = useState<'full' | 'none' | 'other'>('full');
  const [paidOther, setPaidOther] = useState('');
  const [method, setMethod] = useState<Method | null>('cash');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const customer = f.customers.find((c) => c.id === customerId);
  const q = search.trim().toLowerCase();
  const matches = f.customers.filter((c) => c.active && (!q || c.name.toLowerCase().includes(q))).slice(0, 8);

  const quantity = quick ?? norm(other);
  const listed = listPrice(f.prices, currency, saleAt);
  const unitPrice = override ? norm(price) : (listed?.price_per_litre ?? '');
  const valid = decimal(quantity, 6) && Number(quantity) > 0 && decimal(unitPrice, 8) && Number(unitPrice) > 0;
  const totalCents = valid ? saleTotal(quantity, unitPrice) : 0;
  const paidCents = paidChoice === 'full' ? totalCents : paidChoice === 'none' ? 0 : decimal(paidOther, 12) ? toCents(norm(paidOther)) : NaN;
  const date = f.farmDate(saleAt);
  const stockCl = f.available(date);
  const quantityCl = valid ? toCents(quantity) : 0;
  const balanceBefore = customer ? (f.balanceOf(customer.id)[currency] ?? 0) : 0;
  const balanceAfter = balanceBefore + totalCents - (Number.isNaN(paidCents) ? 0 : paidCents);

  function save() {
    setError(null);
    if (!customer) return setError('Choose the customer.');
    if (!decimal(quantity, 6) || Number(quantity) <= 0) return setError('Enter the litres sold, e.g. 2 or 2.5.');
    if (!override && !listed) return setError(`No ${currency} price is set for this date. Set a price, or enter the price for this sale.`);
    if (!decimal(unitPrice, 8) || Number(unitPrice) <= 0) return setError('Enter the price per litre.');
    if (Number.isNaN(paidCents) || paidCents > totalCents) return setError(`Amount paid must be between 0 and the total (${money(totalCents, currency)}). Extra money is recorded as a separate payment.`);
    if (paidCents > 0 && !method) return setError('Choose how the customer paid.');
    // Not silently: an oversell needs a justified stock adjustment first.
    if (quantityCl > stockCl) return setError(`Only ${litres(stockCl)} L of saleable milk is in stock for this date. Record the production or make a stock adjustment with a reason first.`);

    const summary = [
      `${customer.name}`,
      `${quantity} L × ${currency} ${unitPrice}${override ? ' (special price)' : ''}`,
      `Total: ${money(totalCents, currency)}`,
      `Paid now: ${money(paidCents, currency)}${paidCents > 0 ? ` by ${METHOD_LABELS[method!]}` : ''}`,
      `Balance after: ${balanceAfter > 0 ? `owes ${money(balanceAfter, currency)}` : balanceAfter < 0 ? `in credit ${money(-balanceAfter, currency)}` : 'settled'}`,
      `Stock: ${litres(stockCl)} L → ${litres(stockCl - quantityCl)} L`,
    ];
    const finish = () => {
      recordSale({
        customer_id: customer.id,
        sale_at: saleAt,
        quantity: norm(quantity),
        currency,
        price_per_litre: unitPrice,
        override,
        amount_paid: fromCents(paidCents),
        payment_method: paidCents > 0 ? method : 'credit',
        notes: notes.trim() || null,
      });
      router.dismissTo({ pathname: '/customers/[id]', params: { id: customer.id, saved: `${quantity} L, ${money(totalCents, currency)}` } });
    };

    // Every sale is confirmed before saving (spec 12.1): quantity, price, total, payment, balance and stock.
    // Anything unusual is named first so it gets a second look.
    const unusual = [
      override && 'a special price',
      paidCents < totalCents && (paidCents === 0 ? 'nothing paid now' : 'part payment'),
      currency !== f.currency && `${currency}, not your usual currency`,
      quantityCl * 2 > stockCl && 'more than half the milk in stock',
    ].filter(Boolean);
    Alert.alert('Confirm sale', [...(unusual.length ? [`Note: ${unusual.join(', ')}.`, ''] : []), ...summary].join('\n'), [
      { text: 'Go back', style: 'cancel' },
      { text: 'Save sale', onPress: finish },
    ]);
  }

  return (
    <FormScreen title="New sale">
      {error ? <Notice tone="error">{error}</Notice> : null}

      {customer ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '600' }}>{customer.name}</Text>
          <Button label="Change customer" variant="link" onPress={() => setCustomerId(null)} />
        </View>
      ) : (
        <>
          <TextField label="Customer" value={search} onChangeText={setSearch} placeholder="Search by name" autoCorrect={false} />
          <Chips label="Choose" value={null} options={matches.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => v && setCustomerId(v)} />
          <Button label="Add a new customer" variant="link" onPress={() => router.push({ pathname: '/customers/new', params: { for: 'sale' } })} />
        </>
      )}

      <Chips label="Litres" value={quick ?? 'other'} options={[...QUICK.map((v) => ({ value: v, label: `${v} L` })), { value: 'other', label: 'Other' }]} onChange={(v) => setQuick(v === 'other' || !v ? null : v)} allowClear={false} />
      {quick === null ? <TextField label="Litres" value={other} onChangeText={setOther} keyboardType="decimal-pad" maxLength={7} /> : null}

      <Chips
        label="Paid now"
        value={paidChoice}
        options={[
          { value: 'full', label: 'Paid in full' },
          { value: 'none', label: 'Nothing (on credit)' },
          { value: 'other', label: 'Part' },
        ]}
        onChange={(v) => v && setPaidChoice(v)}
        allowClear={false}
      />
      {paidChoice === 'other' ? <TextField label={`Amount paid (${currency})`} value={paidOther} onChangeText={setPaidOther} keyboardType="decimal-pad" /> : null}
      {paidChoice !== 'none' ? (
        <Chips label="Paid by" value={method} options={(Object.keys(METHOD_LABELS) as Method[]).filter((m) => m !== 'credit').map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={setMethod} />
      ) : null}
      {/* Rarely changed: hidden until asked for, so an ordinary sale is three choices and Save. */}
      <Button label={more ? 'Fewer options' : 'Change date, price or add a note'} variant="link" onPress={() => setMore((m) => !m)} />
      {more || !listed ? (
        <View style={{ gap: spacing.md }}>
          <DateTimeField label="Sold at" value={saleAt} onChange={(v) => v && setSaleAt(v)} optional={false} />
          {CURRENCIES.length > 1 ? <Chips label="Currency" value={currency} options={CURRENCIES} onChange={(v) => v && setCurrency(v)} allowClear={false} /> : null}
          <Toggle label="Special price for this sale" hint={listed ? `Listed price: ${currency} ${listed.price_per_litre} per litre` : `No ${currency} price set for this date`} value={override} onChange={setOverride} />
          {override ? <TextField label={`Price per litre (${currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" /> : null}
          <TextField label="Note (optional)" value={notes} onChangeText={setNotes} />
        </View>
      ) : null}

      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, padding: spacing.md, gap: 4, ...shadow }} accessibilityLiveRegion="polite" accessible>
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '600' }}>Total {valid ? money(totalCents, currency) : '—'}</Text>
        <Text style={{ color: t.textMuted, fontSize: 14 }}>
          {valid ? `${quantity} L × ${currency} ${unitPrice}${override ? ' (special price)' : ''}` : !listed && !override ? `No ${currency} price set for this date` : ''}
        </Text>
        {customer && valid ? (
          <Text style={{ color: t.text, fontSize: 15 }}>
            Balance after: {balanceAfter > 0 ? `owes ${money(balanceAfter, currency)}` : balanceAfter < 0 ? `in credit ${money(-balanceAfter, currency)}` : 'settled'}
          </Text>
        ) : null}
        <Text style={{ color: quantityCl > stockCl ? t.danger : t.textMuted, fontSize: 14 }}>
          {quantityCl > stockCl ? `Only ${litres(stockCl)} L in stock for this date` : `Stock for this date: ${litres(stockCl)} L${valid ? ` → ${litres(stockCl - quantityCl)} L` : ''}`}
        </Text>
      </View>
      {quantityCl > stockCl ? <Button label="Make a stock adjustment" variant="secondary" onPress={() => router.push({ pathname: '/stock/new', params: { kind: 'adjustment', date } })} /> : null}
      <Button label="Save sale" onPress={save} />
    </FormScreen>
  );
}
