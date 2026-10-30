import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { listPrice, money } from '../../finance/calc';
import { useFinance } from '../../finance/useFinance';
import { litres } from '../../production/calc';
import { Button } from '../../ui/form';
import { Avatar, Card, Figure, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { SearchBar } from '../../ui/SearchBar';
import { useSyncRefresh } from '../../ui/useSyncRefresh';
import { spacing, useTheme } from '../../ui/theme';

export default function Sales() {
  const t = useTheme();
  const refresh = useSyncRefresh();
  const f = useFinance();
  const [query, setQuery] = useState('');
  const price = listPrice(f.prices, f.currency, new Date().toISOString());
  const q = query.trim().toLowerCase();
  const customers = f.customers.filter((c) => c.active && (!q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)));

  return (
    <ScrollView
      refreshControl={<RefreshControl {...refresh} />}
      style={{ backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Figure label="Milk for sale today" value={`${litres(f.available(f.today))} L`} />
          <Figure label="Price per litre" value={price ? `${f.currency} ${price.price_per_litre}` : 'Not set'} tone={price ? undefined : 'danger'} />
        </View>
        {price ? (
          <Button label="New sale" onPress={() => router.push('/sale/new')} />
        ) : (
          <Button label={`Set the ${f.currency} milk price`} onPress={() => router.push('/prices')} />
        )}
      </Card>
      <ListGroup>
        <ListRow icon="cash-plus" title="Record a payment" href="/payment/new" />
        <ListRow icon="warehouse" title="Milk stock" href="/stock" />
        <ListRow icon="chart-bar" title="Money summary" subtitle="Revenue, payments and expenses" href="/finance" />
        <ListRow icon="tag-outline" title="Milk prices" href="/prices" />
      </ListGroup>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Customers" action="Add" onAction={() => router.push('/customers/new')} />
        {f.customers.length > 6 ? <SearchBar label="Search customers" value={query} onChangeText={setQuery} placeholder="Name or phone" /> : null}
        {customers.length ? (
          <ListGroup>
            {customers.map((c) => {
              const owed = Object.entries(f.balanceOf(c.id)).filter(([, v]) => v !== 0);
              const owes = owed.some(([, v]) => v > 0);
              return (
                <ListRow
                  key={c.id}
                  leading={<Avatar name={c.name} tint={owes ? 'straw' : 'green'} />}
                  title={c.name}
                  value={owed.length ? owed.map(([cur, v]) => (v > 0 ? `Owes ${money(v, cur)}` : `Credit ${money(-v, cur)}`)).join('\n') : 'Settled'}
                  valueTone={owes ? 'danger' : 'muted'}
                  href={{ pathname: '/customers/[id]', params: { id: c.id } }}
                />
              );
            })}
          </ListGroup>
        ) : (
          <Text style={{ color: t.textMuted, fontSize: 16 }}>{f.customers.length ? 'No customers match.' : 'No customers yet.'}</Text>
        )}
      </View>
    </ScrollView>
  );
}
