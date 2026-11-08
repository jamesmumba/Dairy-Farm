import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { displayName } from '../animals/model';
import { deleteAnimal, getAnimal, listAnimals, listBreeds } from '../animals/repo';
import { duplicateKey } from '../care/duplicates';
import { dismissDuplicate } from '../care/duplicatesStore';
import { loadCareData } from '../care/repo';
import type { Customer } from '../finance/model';
import { editCustomer } from '../finance/repo';
import { money, toCents } from '../finance/calc';
import { useFinance } from '../finance/useFinance';
import { formatDate } from '../lib/dates';
import { listMilk } from '../production/repo';
import { getRecord, useLocal } from '../sync/store';
import { Button, FormScreen, Notice } from '../ui/form';
import { Details, ListGroup, ListRow } from '../ui/kit';
import { spacing, type, useTheme } from '../ui/theme';

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
  const care = useLocal(loadCareData);
  const otherOf = (id: string) => (id === a ? b : a);

  // Same person: the other one stops being offered for new sales. Its sales and payments stay as they are.
  function keepCustomer(id: string) {
    const keep = f.customers.find((c) => c.id === id);
    const other = getRecord<Customer>('customers', otherOf(id));
    if (!keep || !other) return;
    Alert.alert(`Keep ${keep.name}?`, `The other one is marked inactive: its sales and payments stay on it, and new ones go on this one.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Keep this one',
        onPress: () => {
          editCustomer(other, { active: false });
          router.back();
        },
      },
    ]);
  }

  // Records on an animal: milk entries, care records and offspring. One with none was entered twice by mistake.
  const recordsOf = (id: string) =>
    milk.filter((m) => m.cattle_id === id && m.status === 'valid').length +
    [care.health, care.visits, care.treatments, care.breeding, care.checks, care.vaccinations, care.actions].reduce((n, rows) => n + rows.filter((r) => r.cattle_id === id).length, 0) +
    care.calvings.filter((k) => k.dam_id === id).length +
    animals.filter((x) => x.data.dam_id === id || x.data.sire_id === id).length;

  function keepAnimal(id: string) {
    const other = getAnimal(otherOf(id));
    if (!other) return;
    Alert.alert('Delete the other one?', 'It has no records, so nothing is lost. This one stays as it is.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete the other',
        style: 'destructive',
        onPress: () => {
          deleteAnimal(other);
          router.back();
        },
      },
    ]);
  }

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
            <ListRow icon="account-check-outline" title="Keep this one" subtitle="The other is marked inactive" onPress={() => keepCustomer(id)} />
            <ListRow icon="account-outline" title={`Open ${c.name}`} href={`/customers/${id}`} />
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
        <Text style={{ color: t.textMuted, ...type.secondary }}>
          If they are the same person, tap Keep this one on the customer with more sales. Record new sales and payments on the one you keep.
        </Text>
        <Button label="They are different people: keep both" variant="secondary" onPress={keepBoth} />
      </FormScreen>
    );
  }

  const card = (id: string) => {
    const x = animals.find((r) => r.data.id === id)?.data;
    if (!x) return null;
    const entries = milk.filter((m) => m.cattle_id === id && m.status === 'valid').length;
    const otherEmpty = recordsOf(otherOf(id)) === 0;
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
          {otherEmpty ? <ListRow icon="check-circle-outline" title="Keep this one" subtitle="Deletes the other, which has no records" onPress={() => keepAnimal(id)} /> : null}
          <ListRow icon="cow" title={`Open ${displayName(x)}`} subtitle={recordsOf(id) ? 'Has records' : 'No records yet'} href={`/animal/${id}`} />
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
      <Text style={{ color: t.textMuted, ...type.secondary }}>
        If they are the same animal, tap Keep this one on the one with records; the other is deleted (offered only while it has no records). If both have records, keep both and give each an ear tag.
      </Text>
      <Button label="They are different animals: keep both" variant="secondary" onPress={keepBoth} />
    </FormScreen>
  );
}
