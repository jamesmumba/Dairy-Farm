import { type Href, router } from 'expo-router';
import { CARE_FORMS } from '../../care/forms';
import type { VaccinationSchedule } from '../../care/model';
import { listCare, loadCareData } from '../../care/repo';
import { useLocal } from '../../sync/store';
import { Button, FormScreen, Notice } from '../../ui/form';
import { ListGroup, ListRow } from '../../ui/kit';

export default function Schedules() {
  const schedules = useLocal(() => listCare<VaccinationSchedule>('schedule'));
  const care = useLocal(loadCareData);
  return (
    <FormScreen title="Vaccination schedules" intro="From your vet and current Zambian livestock requirements. The app has no built-in vaccine calendar.">
      <Button label="Add a schedule" onPress={() => router.push({ pathname: '/care/[kind]/new', params: { kind: 'schedule' } } as Href)} />
      {schedules.length === 0 ? <Notice>No schedules yet.</Notice> : null}
      {schedules.length ? (
        <ListGroup>
          {schedules.map(({ data: s, sync_state }) => (
            <ListRow
              key={s.id}
              icon="needle"
              title={CARE_FORMS.schedule.summary(s, { care })}
              subtitle={`Remind ${s.reminder_offsets_days.join(', ')} days before${s.guidance_source ? ` · ${s.guidance_source}` : ''}${sync_state !== 'synced' ? ' · waiting to sync' : ''}`}
              href={{ pathname: '/care/[kind]/[id]', params: { kind: 'schedule', id: s.id } } as Href}
            />
          ))}
        </ListGroup>
      ) : null}
    </FormScreen>
  );
}
