import { type Href, router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { CARE_FORMS } from '../../care/forms';
import type { VaccinationSchedule } from '../../care/model';
import { listCare, loadCareData } from '../../care/repo';
import { useLocal } from '../../sync/store';
import { Button, FormScreen, Notice } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { minTouch, spacing, useTheme } from '../../ui/theme';

export default function Schedules() {
  const t = useTheme();
  const schedules = useLocal(() => listCare<VaccinationSchedule>('schedule'));
  const care = useLocal(loadCareData);
  return (
    <FormScreen
      title="Vaccination schedules"
      intro="Your schedules, from your vet and current Zambian livestock requirements. They name the vaccine, the interval and when to remind you. The app has no built-in calendar."
    >
      <Button label="Add a schedule" onPress={() => router.push({ pathname: '/care/[kind]/new', params: { kind: 'schedule' } } as Href)} />
      {schedules.length === 0 ? <Notice>No schedules yet.</Notice> : null}
      {schedules.map(({ data: s, sync_state }) => (
        <Pressable
          key={s.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/care/[kind]/[id]', params: { kind: 'schedule', id: s.id } } as Href)}
          style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: spacing.xs }}
        >
          <Text style={{ color: t.text, fontSize: 16 }}>{CARE_FORMS.schedule.summary(s, { care })}</Text>
          <Text style={{ color: t.textMuted, fontSize: 14 }}>Reminders {s.reminder_offsets_days.join(', ')} days before · {s.guidance_source ?? 'source not recorded'}</Text>
          <SyncBadge state={sync_state} />
        </Pressable>
      ))}
    </FormScreen>
  );
}
