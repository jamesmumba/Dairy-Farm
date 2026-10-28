// Dashboard figures that are not already in a report. Pure.

import { activeWithdrawal } from '../care/model';
import { milkAlerts } from '../production/alerts';
import type { ReportInput } from './build';

export type AttentionReason = 'withdrawal' | 'health' | 'overdue_care' | 'production_decline';

/**
 * Active animals that need the farmer's attention, with why: a milk withdrawal in force,
 * an urgent or unresolved health concern, an overdue vaccination / pregnancy check /
 * follow-up (health or alert action), or a sudden or steady fall in milk not yet acted on.
 */
export function needingAttention(input: ReportInput): Map<string, AttentionReason[]> {
  const out = new Map<string, AttentionReason[]>();
  const add = (id: string, reason: AttentionReason) => out.set(id, [...new Set([...(out.get(id) ?? []), reason])]);
  const now = new Date(input.now);
  const { care, today } = input;
  const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

  const milkAlert = new Set(milkAlerts(input.milk, input.animals, care, today, input.declineRule).map((m) => m.cattleId));

  for (const a of input.animals.filter((x) => x.status === 'active')) {
    if (activeWithdrawal(care.treatments, a.id, now)) add(a.id, 'withdrawal');
    const health = live(care.health).filter((h) => h.cattle_id === a.id && !['recovered', 'died'].includes(h.recovery_status));
    if (health.some((h) => h.urgent || h.recovery_status === 'ongoing')) add(a.id, 'health');
    const overdue =
      health.some((h) => h.follow_up_on && h.follow_up_on < today) ||
      live(care.vaccinations).some((v) => v.cattle_id === a.id && v.status === 'scheduled' && v.due_on && v.due_on < today) ||
      live(care.checks).some((c) => c.cattle_id === a.id && c.result === 'pending' && c.scheduled_on && c.scheduled_on < today) ||
      live(care.actions).some((x) => x.cattle_id === a.id && x.status === 'monitoring' && x.follow_up_on && x.follow_up_on < today);
    if (overdue) add(a.id, 'overdue_care');
    if (milkAlert.has(a.id)) add(a.id, 'production_decline');
  }
  return out;
}

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  withdrawal: 'milk withdrawal',
  health: 'health concern',
  overdue_care: 'overdue care',
  production_decline: 'milk down',
};
