import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { displayName } from '../animals/model';
import { listAnimals, listBreeds } from '../animals/repo';
import { duplicateKey } from '../care/duplicates';
import { dismissDuplicate } from '../care/duplicatesStore';
import { money, toCents } from '../finance/calc';
import { useFinance } from '../finance/useFinance';
import { formatDate } from '../lib/dates';
import { listMilk } from '../production/repo';
import { useLocal } from '../sync/store';
import { Button, FormScreen, Notice } from '../ui/form';
import { Details, ListGroup, ListRow } from '../ui/kit';
import { spacing, useTheme } from '../ui/theme';

// Two records that look like the same customer or animal, usually because two phones added it while offline.
// Nothing is merged automatically: sales, payments and milk history stay exactly as recorded. The farmer
// either keeps both (they really are different) or stops using one of them.

export default function Duplicate() {
  const t = useTheme();
  const { kind, a, b } = useLocalSearchParams<{ kind: 'customer' | 'animal'; a: string; b: string }>();
  const f = useFinance();
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  const milk = useLocal(() => listMilk().map((m) => m.data));

  function keepBoth() {
    dismissDuplicate(duplicateKey(kind, a, b));
    router.back();
  }

  if (kind === 'customer') {
    const card = (id: string) => {
      const c = f.customers.find((x) => x.id === id);
      if (!c) return null;
      const sales = f.sales.filter((s) => s.customer_id === id && s.status === 'completed');
      const owed = Object.entries(f.balanceOf(id)).filter(([, v]) => v !== 0);
      return (
        <View key={id} style={{ gap: spacing.sm }}>
          <Details
            rows={[
              ['Name', c.name],
              ['Phone', c.phone],
              ['Address', c.address],
              ['Customer since', formatDate(c.registered_on)],
              ['Sales', `${sales.length} (${money(sales.reduce((s, x) => s + toCents(x.total), 0), f.currency)})`],
              ['Balance', owed.length ? owed.map(([cur, v]) => (v > 0 ? `owes ${money(v, cur)}` : `credit ${money(-v, cur)}`)).join(', ') : 'Nothing owed'],
            ]}
          />
          <ListGroup>
            <ListRow icon="account-outline" title={`Open ${c.name}`} subtitle="To stop using this one: Edit customer › Active off" href={`/customers/${id}`} />
          </ListGroup>
        </View>
      );
    };
    return (
      <FormScreen title="Possible duplicate">
        <Notice tone="attention" title="These two customers look the same">
          Often both phones added the same person while offline. Nothing is merged automatically, so no sale or payment changes.
        </Notice>
        {card(a)}
        {card(b)}
        <Text style={{ color: t.textMuted, fontSize: 14 }}>
          If they are the same person: keep the one with more sales and mark the other inactive. Record new sales and payments on the one you keep.
        </Text>
        <Button label="They are different people: keep both" variant="secondary" onPress={keepBoth} />
      </FormScreen>
    );
  }

  const card = (id: string) => {
    const x = animals.find((r) => r.data.id === id)?.data;
    if (!x) return null;
    const entries = milk.filter((m) => m.cattle_id === id && m.status === 'valid').length;
    return (
      <View key={id} style={{ gap: spacing.sm }}>
        <Details
          rows={[
            ['Name', displayName(x)],
            ['Sex', x.sex === 'female' ? 'Female' : 'Male'],
            ['Breed', breeds.find((br) => br.id === x.breed_id)?.name],
            ['Born', formatDate(x.birth_date)],
            ['Milk entries', String(entries)],
          ]}
        />
        <ListGroup>
          <ListRow icon="cow" title={`Open ${displayName(x)}`} subtitle={entries ? 'Has records: keep this one' : 'No records yet: can be deleted from its page'} href={`/animal/${id}`} />
        </ListGroup>
      </View>
    );
  };
  return (
    <FormScreen title="Possible duplicate">
      <Notice tone="attention" title="These two animals look the same">
        Same name, sex and birth date, and no ear tags. Often both phones registered the same animal while offline.
      </Notice>
      {card(a)}
      {card(b)}
      <Text style={{ color: t.textMuted, fontSize: 14 }}>
        If they are the same animal: keep the one with records and delete the other from its page (only possible while it has no records). Giving each an ear tag prevents this.
      </Text>
      <Button label="They are different animals: keep both" variant="secondary" onPress={keepBoth} />
    </FormScreen>
  );
}
