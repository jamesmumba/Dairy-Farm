import { useMemo } from 'react';
import { listAnimals, listBreeds } from '../animals/repo';
import { loadCareData } from '../care/repo';
import { loadFinance } from '../finance/repo';
import { farmDateOf } from '../lib/dates';
import { DEFAULT_DECLINE_RULE } from '../production/calc';
import { listMilk } from '../production/repo';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import type { ReportInput } from './build';

/** Everything on this phone that reports and the dashboard are built from. */
export function useReportInput(): ReportInput {
  const { account } = useAuth();
  const animals = useLocal(() => listAnimals().map((a) => a.data));
  const breeds = useLocal(listBreeds);
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const care = useLocal(loadCareData);
  const finance = useLocal(loadFinance);
  const timeZone = account?.time_zone;
  const rule = account?.decline_rule ?? DEFAULT_DECLINE_RULE;
  return useMemo(() => {
    const now = new Date().toISOString();
    const farmDate = (iso: string) => farmDateOf(iso, timeZone);
    return { animals, breeds, milk, care, finance, declineRule: rule, today: farmDate(now), now, farmDate };
  }, [animals, breeds, milk, care, finance, rule, timeZone]);
}
