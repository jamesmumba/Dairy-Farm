import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { listPrice, money } from '../../finance/calc';
import { useFinance } from '../../finance/useFinance';
import { litres } from '../../production/calc';
import { Button, TextField } from '../../ui/form';
import { SyncStatus } from '../../ui/SyncStatus';
import { minTouch, spacing, useTheme } from '../../ui/theme';

const LINKS: { label: string; hint: string; href: Href }[] = [
  { label: 'Record a payment', hint: 'Later payments, refunds and adjustments', href: '/payment/new' },
  { label: 'Milk stock', hint: 'Stock by day, milk use and adjustments', href: '/stock' },
  { label: 'Expenses', hint: 'Feed, vet, transport and other costs', href: '/expenses' },
  { label: 'Money summary', hint: 'Revenue, payments, balances and expenses', href: '/finance' },
  { label: 'Milk prices', hint: 'Price per litre and its history', href: '/prices' },
];

export default function Sales() {
  const t = useTheme();
  const f = useFinance();
  const [query, setQuery] = useState('');
  const price = listPrice(f.prices, f.currency, new Date().toISOString());
  const q = query.trim().toLowerCase();
  const customers = f.customers.filter((c) => c.active && (!q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)));

  return (
    <FlatList
      style={{ backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
      keyboardShouldPersistTaps="handled"
      data={customers}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
          <SyncStatus />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 8, padding: spacing.md }} accessible>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>Milk for sale today</Text>
              <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{litres(f.available(f.today))} L</Text>
              {f.unsyncedStockItems ? <Text style={{ color: t.textMuted, fontSize: 12 }}>Includes {f.unsyncedStockItems} not yet synced</Text> : null}
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 8, padding: spacing.md }} accessible>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>Price per litre</Text>
              <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{price ? `${f.currency} ${price.price_per_litre}` : 'Not set'}</Text>
            </View>
          </View>
          {!price ? <Button label={`Set the ${f.currency} milk price`} variant="secondary" onPress={() => router.push('/prices')} /> : null}
          <Button label="New sale" onPress={() => router.push('/sale/new')} />
          {LINKS.map((l) => (
            <Pressable
              key={l.label}
              accessibilityRole="button"
              accessibilityHint={l.hint}
              onPress={() => router.push(l.href)}
              style={{ minHeight: minTouch, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 8, backgroundColor: t.surface }}
            >
              <Text style={{ color: t.text, fontSize: 16 }}>{l.label}</Text>
              <Text style={{ color: t.textMuted, fontSize: 13 }}>{l.hint}</Text>
            </Pressable>
          ))}
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
            Customers
          </Text>
          <TextField label="Search customers" value={query} onChangeText={setQuery} placeholder="Name or phone" autoCorrect={false} />
          <Button label="Add a customer" variant="secondary" onPress={() => router.push('/customers/new')} />
        </View>
      }
      ListEmptyComponent={<Text style={{ color: t.textMuted, fontSize: 16 }}>{f.customers.length ? 'No customers match.' : 'No customers yet.'}</Text>}
      renderItem={({ item: c }) => {
        const owed = Object.entries(f.balanceOf(c.id)).filter(([, v]) => v !== 0);
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/customers/[id]', params: { id: c.id } })}
            style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: spacing.xs }}
          >
            <Text style={{ color: t.text, fontSize: 17 }}>{c.name}</Text>
            <Text style={{ color: owed.some(([, v]) => v > 0) ? t.danger : t.textMuted, fontSize: 14 }}>
              {owed.length ? owed.map(([cur, v]) => (v > 0 ? `Owes ${money(v, cur)}` : `In credit ${money(-v, cur)}`)).join(' · ') : 'Nothing owed'}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
