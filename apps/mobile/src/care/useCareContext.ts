import { listAnimals } from '../animals/repo';
import { toDateString } from '../lib/dates';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import type { FormContext } from './forms';
import { loadCareData } from './repo';

const DEFAULT_INTERVALS = { pregnancy_check_days: 35, gestation_days: 283 };

/** Everything the care forms need: today, the herd, care records, the farmer's intervals. */
export function useCareContext(): FormContext {
  const { account } = useAuth();
  const care = useLocal(loadCareData);
  const animals = useLocal(() => listAnimals().map((a) => a.data).filter((a) => a.status === 'active'));
  const now = new Date();
  return {
    today: toDateString(now),
    now: now.toISOString(),
    care,
    animals,
    intervals: account?.breeding_intervals ?? DEFAULT_INTERVALS,
  };
}
