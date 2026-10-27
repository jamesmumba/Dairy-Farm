import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, NetworkError } from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { getJson, setJson } from '../lib/localDb';
import { Chips } from '../ui/Chips';
import { Button, Notice } from '../ui/form';
import { spacing, useTheme } from '../ui/theme';

interface AuditEntry {
  id: number;
  action: string;
  entity_table: string;
  reason: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  occurred_at: string;
}

const FILTERS = [
  { value: 'milk_sales', label: 'Sales' },
  { value: 'payments', label: 'Payments' },
  { value: 'milk_stock_movements', label: 'Stock' },
  { value: 'milk_prices', label: 'Prices' },
  { value: 'farm_expenses', label: 'Expenses' },
  { value: 'milk_production', label: 'Milk' },
  { value: 'cattle', label: 'Animals' },
  { value: 'farmer_accounts', label: 'Account' },
] as const;

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Changes recorded by your account (corrections, voids, price changes, adjustments…). Needs a connection; the last view is kept. */
export default function AuditHistory() {
  const t = useTheme();
  const [table, setTable] = useState<string | null>(null);
  const cacheKey = `audit.${table ?? 'all'}`;
  const [entries, setEntries] = useState<AuditEntry[]>(() => getJson(cacheKey) ?? []);
  const [offline, setOffline] = useState(false);
  const [more, setMore] = useState(true);

  const load = useCallback(
    async (before?: number) => {
      try {
        const q = new URLSearchParams({ limit: '50', ...(table && { entity_table: table }), ...(before && { before_id: String(before) }) });
        const rows = await api<AuditEntry[]>(`/v1/audit?${q}`);
        setOffline(false);
        setMore(rows.length === 50);
        setEntries((prev) => {
          const next = before ? [...prev, ...rows] : rows;
          if (!before) setJson(cacheKey, rows);
          return next;
        });
      } catch (err) {
        if (err instanceof NetworkError) setOffline(true);
      }
    },
    [table, cacheKey],
  );

  // Fetches from the server (an external system); state is set only after the response.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Chips label="Show" value={table} options={FILTERS} onChange={(v) => { setEntries(getJson(`audit.${v ?? 'all'}`) ?? []); setTable(v); }} />
      {offline ? <Notice>Offline: showing the history last loaded on this phone.</Notice> : null}
      {entries.length === 0 ? <Text style={{ color: t.textMuted }}>No changes recorded yet.</Text> : null}
      {entries.map((e) => {
        const keys = [...new Set([...Object.keys(e.before_data ?? {}), ...Object.keys(e.after_data ?? {})])].filter((k) => !['id', 'owner_id', 'created_at', 'updated_at', 'version'].includes(k)).slice(0, 8);
        return (
          <View key={e.id} style={{ borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: spacing.xs, gap: 2 }} accessible>
            <Text style={{ color: t.textMuted, fontSize: 13 }}>{formatDateTime(e.occurred_at)}</Text>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{e.action.replace(/[._]/g, ' ')}</Text>
            {e.reason ? <Text style={{ color: t.text, fontSize: 15 }}>Reason: {e.reason}</Text> : null}
            {e.before_data
              ? keys.map((k) => (
                  <Text key={k} style={{ color: t.textMuted, fontSize: 14 }}>
                    {k.replace(/_/g, ' ')}: {show(e.before_data?.[k])} → {show(e.after_data?.[k])}
                  </Text>
                ))
              : null}
          </View>
        );
      })}
      {more && entries.length && !offline ? <Button label="Load older" variant="link" onPress={() => load(entries[entries.length - 1].id)} /> : null}
    </ScrollView>
  );
}
