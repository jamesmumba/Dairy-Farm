import { router } from 'expo-router';
import { AnimalForm, emptyFields } from '../../animals/AnimalForm';
import { listAnimals, listBreeds, registerAnimal } from '../../animals/repo';
import { useAuth } from '../../state/auth';
import { useLocal } from '../../sync/store';
import { FormScreen } from '../../ui/form';

export default function NewAnimal() {
  const { account } = useAuth();
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);

  return (
    <FormScreen card title="Register an animal" intro="Only sex is required. Everything else can be added later. Works offline: the animal is saved on this phone and synced when you are connected.">
      <AnimalForm
        draftKey="animal-new"
        initial={emptyFields(account?.currency ?? 'ZMW')}
        animals={animals.map((a) => a.data)}
        breeds={breeds}
        submitLabel="Save animal"
        onSubmit={(fields) => {
          const id = registerAnimal(fields);
          router.replace({ pathname: '/animal/[id]', params: { id } });
        }}
      />
    </FormScreen>
  );
}
