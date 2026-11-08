import { router, useLocalSearchParams } from 'expo-router';
import { displayName } from '../../../animals/model';
import { findExisting } from '../../../care/existing';
import { CareForm } from '../../../care/CareForm';
import { CARE_FORMS, latestPregnancy } from '../../../care/forms';
import { CARE_KINDS, type CareKind } from '../../../care/model';
import { createCare, getCare, updateCare } from '../../../care/repo';
import { useCareContext } from '../../../care/useCareContext';
import { askIfExisting } from '../../../ui/askIfExisting';
import { FormScreen, Notice } from '../../../ui/form';

export default function NewCareRecord() {
  const { kind, cattle_id, alert_type, alert_reason, health_record_id, from_action } = useLocalSearchParams<{
    kind: CareKind;
    cattle_id?: string;
    alert_type?: string;
    alert_reason?: string;
    health_record_id?: string;
    /** A health concern started from an action on a milk alert: the action is linked to it. */
    from_action?: string;
  }>();
  const ctx = useCareContext();
  if (!(kind in CARE_KINDS)) return <FormScreen card title="Record"><Notice tone="error">Unknown record type.</Notice></FormScreen>;
  const config = CARE_FORMS[kind];
  const animalKey = config.fields.find((f) => f.type === 'animal')?.key;

  return (
    <FormScreen card title={CARE_KINDS[kind].label}>
      <CareForm
        kind={kind}
        draftKey={`care-new-${kind}-${cattle_id ?? ''}-${health_record_id ?? ''}`}
        initial={{
          ...config.defaults(ctx),
          ...(animalKey && cattle_id ? { [animalKey]: cattle_id } : {}),
          // From an early-warning alert: what it was about and why, kept with the action.
          ...(kind === 'action' && alert_type ? { alert_type, alert_reason: alert_reason ?? '' } : {}),
          // From a health concern: the treatment or visit is linked to it.
          ...(health_record_id && config.fields.some((f) => f.key === 'health_record_id') ? { health_record_id } : {}),
          // A calving for a known cow: joined to her latest confirmed pregnancy.
          ...(kind === 'calving' && cattle_id ? { pregnancy_check_id: latestPregnancy(ctx, cattle_id, ctx.today)?.id ?? '' } : {}),
        }}
        ctx={ctx}
        creating
        submitLabel="Save"
        onSubmit={(body, createOnly) => {
          const save = () => {
            const id = createCare(kind, body, createOnly);
            const action = kind === 'health' && from_action ? getCare<{ id: string; version: number; deleted_at: string | null }>('action', from_action) : null;
            if (action) updateCare('action', action, { health_record_id: id });
            router.replace({ pathname: '/care/[kind]/[id]', params: { kind, id } });
          };
          // The same dose, check, concern or event may already be recorded (often from another phone).
          const cow = ctx.animals.find((a) => a.id === (body.cattle_id ?? body.dam_id));
          const found = findExisting(kind, body, ctx.care, cow ? displayName(cow) : 'This animal', ctx.today);
          if (!found) return save();
          askIfExisting(found.message, () => router.replace({ pathname: '/care/[kind]/[id]', params: { kind: found.kind, id: found.id } }), save);
        }}
      />
    </FormScreen>
  );
}
