import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { likelyDuplicates } from '../../finance/calc';
import { CUSTOMER_TYPES, type Customer } from '../../finance/model';
import { addCustomer } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { Chips } from '../../ui/Chips';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function NewCustomer() {
  const f = useFinance();
  // Opened from the sale form: go back to it with this customer chosen, not on to their page.
  const { for: forSale } = useLocalSearchParams<{ for?: string }>();
  const open = (id: string) =>
    forSale === 'sale' ? router.dismissTo({ pathname: '/sale/new', params: { customer_id: id } }) : router.replace({ pathname: '/customers/[id]', params: { id } });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<Customer['customer_type']>('individual');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!name.trim()) return setError('Enter the customer’s name.');
    if (phone.trim() && !/^\+?[0-9 ]{7,20}$/.test(phone.trim())) return setError('Enter a phone number, e.g. +260 97 123 4567.');
    const create = () => {
      const id = addCustomer({ name: name.trim(), phone: phone.trim() || null, address: address.trim() || null, customer_type: type, notes: notes.trim() || null });
      open(id);
    };
    // Help avoid duplicates: confirm when someone similar already exists.
    const similar = likelyDuplicates(f.customers, name, phone);
    if (!similar.length) return create();
    Alert.alert('Is this an existing customer?', `Similar: ${similar.map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ''}`).join(', ')}`, [
      { text: 'Open existing', onPress: () => open(similar[0].id) },
      { text: 'Add as new', onPress: create },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <FormScreen card title="New customer">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <TextField label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextField label="Address (optional)" value={address} onChangeText={setAddress} />
      <Chips label="Type" value={type} options={Object.entries(CUSTOMER_TYPES).map(([value, label]) => ({ value: value as Customer['customer_type'], label }))} onChange={(v) => v && setType(v)} allowClear={false} />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      <Button label="Save customer" onPress={save} />
    </FormScreen>
  );
}
