import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { ParentPicker } from '../../animals/ParentPicker';
import { CATEGORY_LABELS, METHOD_LABELS, type Method } from '../../finance/model';
import { CURRENCIES } from '../../lib/account';
import { formatDate, formatDateTime } from '../../lib/dates';
import { addDays, type Period, periodRange } from '../../production/calc';
import { type Filters, REPORTS, type Table } from '../../reports/build';
import { exportReport } from '../../reports/exportFile';
import { useReportInput } from '../../reports/useReportInput';
import { useAuth } from '../../state/auth';
import { useSyncStatus } from '../../sync/engine';
import { Chips } from '../../ui/Chips';
import { DateField } from '../../ui/DateField';
import { Button, Notice } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { Card, SectionHeader } from '../../ui/kit';
import { FilterButton, FilterSheet } from '../../ui/SearchBar';
import { radius, shadow, spacing, useCardBasis, useTheme } from '../../ui/theme';

/** Rows shown before "Show all": the latest days of a daily table, or the first rows of any other. */
const SHOWN_DAYS = 14;
const SHOWN_ROWS = 25;

function ReportTable({ table }: { table: Table }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const width = (c: { numeric?: boolean }) => (c.numeric ? 90 : 140);
  const limit = table.daily ? SHOWN_DAYS : SHOWN_ROWS;
  const cut = !all && table.rows.length > limit;
  const rows = !cut ? table.rows : table.daily ? table.rows.slice(-limit) : table.rows.slice(0, limit);
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title={table.title} />
      {table.rows.length === 0 ? (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>{table.empty ?? 'No records.'}</Text>
      ) : (
        <ScrollView horizontal accessibilityHint="Scroll sideways to see all columns" style={{ backgroundColor: t.surface, borderRadius: radius.card, ...shadow }} contentContainerStyle={{ padding: spacing.md }}>
          <View>
            <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
              {table.columns.map((c) => (
                <Text key={c.key} style={{ width: width(c), color: t.textMuted, fontSize: 13, paddingVertical: 4, textAlign: c.numeric ? 'right' : 'left', paddingRight: 8 }}>
                  {c.label}
                </Text>
              ))}
            </View>
            {rows.map((row, i) => (
              <View
                key={i}
                accessible
                accessibilityLabel={table.columns.map((c) => `${c.label || ''} ${row[c.key] ?? ''}`).join(', ')}
                style={{ flexDirection: 'row', borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
              >
                {table.columns.map((c) => (
                  <Text key={c.key} style={{ width: width(c), color: t.text, fontSize: 14, paddingVertical: 6, textAlign: c.numeric ? 'right' : 'left', paddingRight: 8, fontVariant: ['tabular-nums'] }}>
                    {row[c.key] ?? ''}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {cut ? (
        <Button
          label={`Show all ${table.rows.length} rows${table.daily ? ` (showing the last ${limit} days)` : ''}`}
          variant="link"
          onPress={() => setAll(true)}
        />
      ) : null}
    </View>
  );
}

type Choice = Exclude<Period, 'today'> | 'last_month' | 'custom';

export default function ReportScreen() {
  const t = useTheme();
  const basis = useCardBasis();
  const { id } = useLocalSearchParams<{ id: string }>();
  const def = REPORTS.find((r) => r.id === id);
  const input = useReportInput();
  const { account } = useAuth();
  const sync = useSyncStatus();
  const [period, setPeriod] = useState<Choice>('month');
  const [custom, setCustom] = useState({ from: periodRange('month', input.today).from, to: input.today });
  const [filters, setFilters] = useState<Omit<Filters, 'from' | 'to'>>({ currency: account?.currency ?? 'ZMW' });
  const [busy, setBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (def) navigation.setOptions({ title: def.title });
  }, [navigation, def]);
  const range =
    period === 'custom' ? custom : period === 'last_month' ? periodRange('month', addDays(`${input.today.slice(0, 7)}-01`, -1)) : periodRange(period, input.today);
  const from = range.from;
  const to = range.to > input.today ? input.today : range.to;
  const backwards = from > to;
  const f: Filters = { ...filters, from, to };
  const report = useMemo(() => (def ? def.build(input, { ...filters, from, to }) : null), [def, input, filters, from, to]);

  if (!def || !report) return <MissingRecord what="report" message="There is no such report. Open Reports to choose one." />;
  const set = (patch: Partial<Filters>) => setFilters((x) => ({ ...x, ...patch }));
  const hasFilters = def.filters.length > 0 || def.id === 'finance';
  const activeFilters = [filters.cattleId, filters.breedId, filters.customerId, filters.method, filters.paid, filters.category].filter(Boolean).length;

  function share(format: 'csv' | 'pdf') {
    Alert.alert(
      'Share farm records?',
      `This ${format.toUpperCase()} file contains your farm records${def!.id === 'finance' ? ', including customer names and money owed' : ''}. Share it only with people and apps you trust.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: async () => {
            setBusy(true);
            try {
              await exportReport(report!, format, account?.farm_name ?? null);
            } catch {
              Alert.alert('Could not create the file', 'Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <Chips
        label="Period"
        value={period}
        options={[
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
          { value: 'year', label: 'This year' },
          { value: 'custom', label: 'Dates…' },
        ]}
        onChange={(v) => v && setPeriod(v)}
        allowClear={false}
      />
      {period === 'custom' ? (
        <>
          <DateField label="From" value={custom.from} onChange={(d) => d && setCustom((c) => ({ ...c, from: d }))} optional={false} />
          <DateField label="To" value={custom.to} onChange={(d) => d && setCustom((c) => ({ ...c, to: d }))} optional={false} />
        </>
      ) : null}
      {backwards ? <Notice tone="error">“From” is after “To”. Swap the dates to see the report.</Notice> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Share PDF" onPress={() => share('pdf')} busy={busy} disabled={backwards} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Share CSV" variant="secondary" onPress={() => share('csv')} disabled={busy || backwards} />
        </View>
        {hasFilters ? <FilterButton activeFilters={activeFilters} onPress={() => setShowFilters(true)} /> : null}
      </View>
      <FilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onClear={activeFilters ? () => setFilters((x) => ({ currency: x.currency })) : undefined}
        showLabel="Show report"
      >
        {def.filters.includes('animal') ? <ParentPicker label="Animal (optional)" value={filters.cattleId ?? null} animals={input.animals} onChange={(cattleId) => set({ cattleId })} /> : null}
        {def.filters.includes('breed') ? <Chips label="Breed" value={filters.breedId ?? null} options={input.breeds.map((b) => ({ value: b.id, label: b.name }))} onChange={(breedId) => set({ breedId })} /> : null}
        {def.id === 'finance' ? <Chips label="Currency" value={filters.currency} options={CURRENCIES} onChange={(currency) => currency && set({ currency })} allowClear={false} /> : null}
        {def.filters.includes('customer') ? <Chips label="Customer" value={filters.customerId ?? null} options={input.finance.customers.map((c) => ({ value: c.id, label: c.name }))} onChange={(customerId) => set({ customerId })} /> : null}
        {def.filters.includes('method') ? <Chips label="Payment method" value={filters.method ?? null} options={(Object.keys(METHOD_LABELS) as Method[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(method) => set({ method })} /> : null}
        {def.filters.includes('paid') ? <Chips label="Sale payment status" value={filters.paid ?? null} options={[{ value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' }]} onChange={(paid) => set({ paid })} /> : null}
        {def.filters.includes('category') ? <Chips label="Expense category" value={filters.category ?? null} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} onChange={(category) => set({ category })} /> : null}
      </FilterSheet>

      {/* Dates the wrong way round: only the notice above, no empty report. */}
      {backwards ? null : (
        <>
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            {formatDate(f.from)} – {formatDate(f.to)} · {report.units} · made {formatDateTime(report.generatedAt)}
            {sync.pending ? ` · ${sync.pending} not yet synced` : ''}
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {report.summary.map((s) => (
              <View key={s.label} style={{ flexBasis: basis, flexGrow: 1, backgroundColor: t.surface, borderRadius: radius.card, ...shadow, padding: spacing.md }} accessible accessibilityLabel={`${s.label}: ${s.value}. ${s.note ?? ''}`}>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>{s.label}</Text>
                <Text style={{ color: t.text, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{s.value}</Text>
                {s.note ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{s.note}</Text> : null}
              </View>
            ))}
          </View>
          {report.missing.map((m) => (
            <Notice key={m} tone="attention">
              {m}
            </Notice>
          ))}
          {report.tables.map((table) => (
            <ReportTable key={table.title} table={table} />
          ))}

          <Button label={showHow ? 'Hide how these are calculated' : 'How these figures are calculated'} variant="link" onPress={() => setShowHow((v) => !v)} />
          {showHow ? (
            <Card gap={spacing.sm}>
              {report.definitions.map((d) => (
                <Text key={d} style={{ color: t.textMuted, fontSize: 14 }}>
                  • {d}
                </Text>
              ))}
              <Text style={{ color: t.textMuted, fontSize: 13 }}>
                Made {formatDateTime(report.generatedAt)} from records on this phone. Records made on another phone appear after they sync.
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
