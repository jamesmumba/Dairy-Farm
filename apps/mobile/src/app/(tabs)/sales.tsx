import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { listPrice, money } from '../../finance/calc';
import { useFinance } from '../../finance/useFinance';
import { litres } from '../../production/calc';
import { Button, TextField } from '../../ui/form';
import { Avatar, ListGroup, ListRow, SectionHeader, StatCard } from '../../ui/kit';
import { radius, shadow, spacing, useTheme } from '../../ui/theme';

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
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
      keyboardShouldPersistTaps="handled"
      data={customers}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <StatCard icon="warehouse" label="Milk for sale today" value={`${litres(f.available(f.today))} L`} note={f.unsyncedStockItems ? `Includes ${f.unsyncedStockItems} not yet synced` : undefined} href="/stock" />
            <StatCard icon="tag-outline" tint="straw" label="Price per litre" value={price ? `${f.currency} ${price.price_per_litre}` : 'Not set'} href="/prices" alert={!price} />
          </View>
          {!price ? <Button label={`Set the ${f.currency} milk price`} variant="secondary" onPress={() => router.push('/prices')} /> : null}
          <Button label="New sale" onPress={() => router.push('/sale/new')} />
          <ListGroup>
            <ListRow icon="cash-plus" title="Record a payment" subtitle="Later payments, refunds and adjustments" href="/payment/new" />
            <ListRow icon="warehouse" tint="sky" title="Milk stock" subtitle="Stock by day, milk use and adjustments" href="/stock" />
            <ListRow icon="chart-bar" tint="sky" title="Money summary" subtitle="Revenue, payments, balances and expenses" href="/finance" />
            <ListRow icon="receipt" tint="straw" title="Expenses" subtitle="Feed, vet, transport and other costs" href="/expenses" />
            <ListRow icon="tag-outline" tint="straw" title="Milk prices" subtitle="Price per litre and its history" href="/prices" />
          </ListGroup>
          <SectionHeader title="Customers" action="Add" onAction={() => router.push('/customers/new')} />
          <TextField label="Search customers" value={query} onChangeText={setQuery} placeholder="Name or phone" autoCorrect={false} />
        </View>
      }
      ListEmptyComponent={<Text style={{ color: t.textMuted, fontSize: 16 }}>{f.customers.length ? 'No customers match.' : 'No customers yet.'}</Text>}
      renderItem={({ item: c, index }) => {
        const owed = Object.entries(f.balanceOf(c.id)).filter(([, v]) => v !== 0);
        const owes = owed.some(([, v]) => v > 0);
        // Customers sit in one rounded group: the first and last rows carry the corners.
        const last = index === customers.length - 1;
        return (
          <View
            style={{
              backgroundColor: t.surface,
              borderColor: t.border,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderTopWidth: index === 0 ? 1 : 0,
              borderBottomWidth: last ? 1 : 0,
              borderTopLeftRadius: index === 0 ? radius.card : 0,
              borderTopRightRadius: index === 0 ? radius.card : 0,
              borderBottomLeftRadius: last ? radius.card : 0,
              borderBottomRightRadius: last ? radius.card : 0,
              overflow: 'hidden',
              ...(last ? shadow : null),
            }}
          >
            {index > 0 ? <View style={{ height: 1, backgroundColor: t.border, marginLeft: 76 }} /> : null}
            <ListRow
              leading={<Avatar name={c.name} tint={owes ? 'straw' : 'green'} />}
              title={c.name}
              subtitle={c.phone ?? undefined}
              value={owed.length ? owed.map(([cur, v]) => (v > 0 ? `Owes ${money(v, cur)}` : `Credit ${money(-v, cur)}`)).join('\n') : 'Settled'}
              valueTone={owes ? 'danger' : 'muted'}
              href={{ pathname: '/customers/[id]', params: { id: c.id } }}
            />
          </View>
        );
      }}
    />
  );
}
