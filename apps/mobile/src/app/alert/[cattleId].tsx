import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { displayName } from '../../animals/model';
import { getAnimal, listAnimals } from '../../animals/repo';
import { CARE_FORMS } from '../../care/forms';
import { loadCareData } from '../../care/repo';
import { formatDate } from '../../lib/dates';
import { milkAlerts } from '../../production/alerts';
import { DEFAULT_DECLINE_RULE } from '../../production/calc';
import { listMilk } from '../../production/repo';
import { useReportInput } from '../../reports/useReportInput';
import { useAuth } from '../../state/auth';
import { useLocal } from '../../sync/store';
import { Button, FormScreen, Notice } from '../../ui/form';
import { ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { MissingRecord } from '../../ui/ProblemView';
import { spacing, useTheme } from '../../ui/theme';

// One cow's early-warning alert: what triggered it, what to check, and what has been done so far.
// Recording an action closes the loop; the follow-up reminder brings the farmer back to it.

export default function AlertScreen() {
  const t = useTheme();
  const { cattleId } = useLocalSearchParams<{ cattleId: string }>();
  const { account } = useAuth();
  const { today } = useReportInput();
  const cow = useLocal(() => getAnimal(cattleId), cattleId);
  const animals = useLocal(listAnimals);
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const care = useLocal(loadCareData);
  const rule = account?.decline_rule ?? DEFAULT_DECLINE_RULE;
  const alert = useMemo(
    () => milkAlerts(milk, animals.map((a) => a.data).filter((a) => a.id === cattleId), care, today, rule)[0],
    [milk, animals, care, today, rule, cattleId],
  );
  if (!cow) return <MissingRecord what="animal" />;
  const name = displayName(cow.data);
  const actions = care.actions.filter((a) => a.cattle_id === cattleId).sort((a, b) => b.action_on.localeCompare(a.action_on));
  const open = actions.find((a) => a.status === 'monitoring');

  return (
    <FormScreen title={name}>
      {alert ? (
        <>
          <Notice tone="attention" title={alert.title}>
            {alert.reason}.
          </Notice>
          <SectionHeader title="What to check" />
          <View style={{ gap: spacing.sm }}>
            {alert.steps.map((s, i) => (
              <Text key={s} style={{ color: t.text, fontSize: 16 }}>
                {i + 1}. {s}
              </Text>
            ))}
          </View>
          <Button
            label="Record what you did"
            onPress={() =>
              router.push({ pathname: '/care/[kind]/new', params: { kind: 'action', cattle_id: cattleId, alert_type: alert.type, alert_reason: alert.reason } } as Href)
            }
          />
        </>
      ) : open ? (
        <Notice title="Being watched">
          You recorded what you did on {formatDate(open.action_on)}. Check on her again on {formatDate(open.follow_up_on)}, then record how she is.
        </Notice>
      ) : (
        <Notice tone="success" title="No milk alert now">
          Her milk is in line with her usual amount, or you have already dealt with the last alert.
        </Notice>
      )}
      <Button label="Her milk records" variant="secondary" onPress={() => router.push({ pathname: '/animal/[id]', params: { id: cattleId } })} />

      {actions.length ? (
        <>
          <SectionHeader title="What has been done" />
          <ListGroup>
            {actions.map((a) => (
              <ListRow
                key={a.id}
                icon="clipboard-check-outline"
                tint={a.status === 'monitoring' ? 'straw' : 'green'}
                title={CARE_FORMS.action.summary(a, { care })}
                subtitle={[formatDate(a.action_on), a.alert_reason].filter(Boolean).join(' · ')}
                href={{ pathname: '/care/[kind]/[id]', params: { kind: 'action', id: a.id } } as Href}
              />
            ))}
          </ListGroup>
        </>
      ) : null}
      <Text style={{ color: t.textMuted, fontSize: 13 }}>
        Alerts compare her records with her own usual milk. They do not diagnose: when in doubt, ask your vet.
      </Text>
    </FormScreen>
  );
}
