import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, Text } from 'react-native';
import type { Cattle } from '../animals/model';
import { loadCareData } from '../care/repo';
import { useReportInput } from '../reports/useReportInput';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import { Notice } from '../ui/form';
import { useTheme } from '../ui/theme';
import { milkAlerts } from './alerts';
import { DEFAULT_DECLINE_RULE } from './calc';
import { listMilk } from './repo';

/** On a cow's profile: her milk alert, if any, opening the alert with what to check. */
export function MilkAlertBanner({ animal }: { animal: Cattle }) {
  const t = useTheme();
  const { account } = useAuth();
  const { today } = useReportInput();
  const milk = useLocal(() => listMilk().filter((m) => m.data.cattle_id === animal.id).map((m) => m.data), animal.id);
  const care = useLocal(loadCareData);
  const rule = account?.decline_rule ?? DEFAULT_DECLINE_RULE;
  const alert = useMemo(() => milkAlerts(milk, [animal], care, today, rule)[0], [milk, animal, care, today, rule]);
  if (!alert) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens what to check" onPress={() => router.push({ pathname: '/alert/[cattleId]', params: { cattleId: animal.id } })}>
      <Notice tone="attention" title={alert.title}>
        {alert.reason}.{' '}
        <Text style={{ color: t.primary, fontWeight: '600' }}>What to check ›</Text>
      </Notice>
    </Pressable>
  );
}
