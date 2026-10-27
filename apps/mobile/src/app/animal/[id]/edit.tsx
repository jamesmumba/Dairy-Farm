import { router, useLocalSearchParams } from 'expo-router';
import { AnimalForm } from '../../../animals/AnimalForm';
import type { CattleFields } from '../../../animals/model';
import { editAnimal, getAnimal, listAnimals, listBreeds } from '../../../animals/repo';
import { useLocal } from '../../../sync/store';
import { FormScreen, Notice } from '../../../ui/form';

const FIELDS: (keyof CattleFields)[] = [
  'ear_tag', 'name', 'breed_id', 'sex', 'birth_date', 'birth_date_estimated', 'acquisition_date', 'acquisition_source',
  'purchase_price', 'purchase_currency', 'weight_kg', 'dam_id', 'sire_id', 'sire_identifier', 'reproductive_status',
  'production_status', 'notes',
];

export default function EditAnimal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const animal = useLocal(() => getAnimal(id), id);
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  if (!animal) return <FormScreen title="Edit animal"><Notice tone="error">This animal is no longer in your herd.</Notice></FormScreen>;

  const initial = Object.fromEntries(FIELDS.map((k) => [k, animal.data[k]])) as CattleFields;
  return (
    <FormScreen title="Edit animal">
      <AnimalForm
        draftKey={`animal-edit-${id}`}
        initial={initial}
        selfId={id}
        animals={animals.map((a) => a.data)}
        breeds={breeds}
        submitLabel="Save changes"
        onSubmit={(fields) => {
          // Send only what changed, so edits made elsewhere to other fields are not overwritten.
          const changes = Object.fromEntries(FIELDS.filter((k) => fields[k] !== initial[k]).map((k) => [k, fields[k]]));
          if (Object.keys(changes).length) editAnimal(animal, changes);
          router.back();
        }}
      />
    </FormScreen>
  );
}
