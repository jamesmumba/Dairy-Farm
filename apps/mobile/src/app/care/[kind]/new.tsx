import { router, useLocalSearchParams } from 'expo-router';
import { CareForm } from '../../../care/CareForm';
import { CARE_FORMS } from '../../../care/forms';
import { CARE_KINDS, type CareKind } from '../../../care/model';
import { createCare } from '../../../care/repo';
import { useCareContext } from '../../../care/useCareContext';
import { FormScreen, Notice } from '../../../ui/form';

export default function NewCareRecord() {
  const { kind, cattle_id, alert_type, alert_reason } = useLocalSearchParams<{ kind: CareKind; cattle_id?: string; alert_type?: string; alert_reason?: string }>();
  const ctx = useCareContext();
  if (!(kind in CARE_KINDS)) return <FormScreen card title="Record"><Notice tone="error">Unknown record type.</Notice></FormScreen>;
  const config = CARE_FORMS[kind];
  const animalKey = config.fields.find((f) => f.type === 'animal')?.key;

  return (
    <FormScreen card title={CARE_KINDS[kind].label}>
      <CareForm
        kind={kind}
        draftKey={`care-new-${kind}-${cattle_id ?? ''}`}
        initial={{
          ...config.defaults(ctx),
          ...(animalKey && cattle_id ? { [animalKey]: cattle_id } : {}),
          // From an early-warning alert: what it was about and why, kept with the action.
          ...(kind === 'action' && alert_type ? { alert_type, alert_reason: alert_reason ?? '' } : {}),
        }}
        ctx={ctx}
        creating
        submitLabel="Save"
        onSubmit={(body, createOnly) => {
          const id = createCare(kind, body, createOnly);
          router.replace({ pathname: '/care/[kind]/[id]', params: { kind, id } });
        }}
      />
    </FormScreen>
  );
}
