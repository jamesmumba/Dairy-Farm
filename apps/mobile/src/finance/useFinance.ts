import { useMemo } from 'react';
import { farmDateOf } from '../lib/dates';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import { availableOn, balances, ledger } from './calc';
import { loadFinance, pendingStock } from './repo';

/** Finance records on this phone, plus helpers every finance screen needs. */
export function useFinance() {
  const { account } = useAuth();
  const data = useLocal(loadFinance);
  const pending = useLocal(pendingStock);
  const timeZone = account?.time_zone ?? 'Africa/Lusaka';
  return useMemo(() => {
    const farmDate = (iso: string) => farmDateOf(iso, timeZone);
    const entries = ledger(data.movements, pending, farmDate);
    return {
      ...data,
      currency: account?.currency ?? 'ZMW',
      farmDate,
      today: farmDate(new Date().toISOString()),
      /** Litres that can still go out on a farm date, as the server will check it. */
      available: (date: string) => availableOn(entries, date),
      unsyncedStockItems: pending.sales.length + pending.production.length,
      balanceOf: (customerId: string) => balances(customerId, data.sales, data.payments),
    };
  }, [data, pending, account?.currency, timeZone]);
}
