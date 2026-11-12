import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ParentPicker } from '../../animals/ParentPicker';
import { CATEGORY_LABELS, METHOD_LABELS, type Method } from '../../finance/model';
import { CURRENCIES } from '../../lib/account';
import { formatDateTime } from '../../lib/dates';
import { lastMonthRange, type Period, periodRange } from '../../production/calc';
import { type Filters, REPORTS, type Table } from '../../reports/build';
import { exportReport } from '../../reports/exportFile';
import { rangeLabel } from '../../reports/format';
import { useReportInput } from '../../reports/useReportInput';
import { useAuth } from '../../state/auth';
import { useSyncStatus } from '../../sync/engine';
import { Chips } from '../../ui/Chips';
import { DateField } from '../../ui/DateField';
import { Expander, Notice } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { Card } from '../../ui/kit';
import { FilterButton, FilterSheet } from '../../ui/SearchBar';
import { SyncHeader } from '../../ui/SyncHeader';
import { minTouch, radius, shadow, spacing, type, useTheme } from '../../ui/theme';

/** Rows shown before "Show all": the latest days of a daily table, or the first rows of any other. */
const SHOWN_DAYS = 14;
const SHOWN_ROWS = 25;
/** Tables this narrow fit a phone as plain rows; wider ones scroll sideways. */
const LIST_COLUMNS = 3;

/** A table in a card: its heading with the row count, then the rows. */
function ReportTable({ table }: { table: Table }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const limit = table.daily ? SHOWN_DAYS : SHOWN_ROWS;
  const cut = !all && table.rows.length > limit;
  const rows = !cut ? table.rows : table.daily ? table.rows.slice(-limit) : table.rows.slice(0, limit);
  const asList = table.columns.length <= LIST_COLUMNS;
  const width = (c: { numeric?: boolean }) => (c.numeric ? 90 : 140);

  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.card, ...shadow, overflow: 'hidden' }}>
      <View accessibilityRole="header" style={{ minHeight: minTouch, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }}>
        <Text style={{ flex: 1, color: t.text, ...type.cardTitle }}>{table.title}</Text>
        <Text style={{ color: t.textMuted, ...type.secondary, fontVariant: ['tabular-nums'] }}>{table.rows.length}</Text>
      </View>
      {asList ? (
        // Narrow tables: plain rows, the first column on the left and the figures on the right.
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          {rows.map((row, i) => (
            <View
              key={i}
              accessible
              accessibilityLabel={table.columns.map((c) => `${c.label || ''} ${row[c.key] ?? ''}`).join(', ')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.border }}
            >
              <Text style={{ flex: 1, color: t.text, ...type.bodySmall }}>{row[table.columns[0].key] ?? ''}</Text>
              {table.columns.slice(1).map((c) => (
                <Text key={c.key} style={{ color: c.numeric ? t.text : t.textMuted, ...type.bodySmall, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {row[c.key] ?? ''}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <ScrollView horizontal accessibilityHint="Scroll sideways to see all columns" contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          <View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.border, paddingTop: 4 }}>
              {table.columns.map((c) => (
                <Text key={c.key} style={{ width: width(c), color: t.textMuted, ...type.caption, paddingVertical: 4, textAlign: c.numeric ? 'right' : 'left', paddingRight: 8 }}>
                  {c.label}
                </Text>
              ))}
            </View>
            {rows.map((row, i) => (
              <View
                key={i}
                accessible
                accessibilityLabel={table.columns.map((c) => `${c.label || ''} ${row[c.key] ?? ''}`).join(', ')}
                style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.border }}
              >
                {table.columns.map((c) => (
                  <Text key={c.key} style={{ width: width(c), color: t.text, ...type.secondary, paddingVertical: 6, textAlign: c.numeric ? 'right' : 'left', paddingRight: 8, fontVariant: ['tabular-nums'] }}>
                    {row[c.key] ?? ''}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {cut ? (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          <Expander icon="table-row" label={`Show all ${table.rows.length} rows${table.daily ? ` (showing the last ${limit} days)` : ''}`} open={false} onToggle={() => setAll(true)} />
        </View>
      ) : null}
    </View>
  );
}

/** The share icon in the header: one tap, then PDF or CSV. */
function HeaderShare({ onPress, busy, disabled }: { onPress: () => void; busy: boolean; disabled: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share this report"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={8}
      style={{ minWidth: minTouch - 8, height: 36, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      {busy ? <ActivityIndicator color={t.primary} /> : <MaterialCommunityIcons name="share-variant-outline" size={22} color={t.text} />}
    </Pressable>
  );
}

type Choice = Exclude<Period, 'today'> | 'last_month' | 'custom';

export default function ReportScreen() {
  const t = useTheme();
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
  const range =
    period === 'custom' ? custom : period === 'last_month' ? lastMonthRange(input.today) : periodRange(period, input.today);
  const from = range.from;
  const to = range.to > input.today ? input.today : range.to;
  const backwards = from > to;
  const report = useMemo(() => (def ? def.build(input, { ...filters, from, to }) : null), [def, input, filters, from, to]);

  // Sharing is occasional, so it lives in the header: one tap asks PDF or CSV, and says what the file holds.
  const askShare = useRef(() => {});
  useEffect(() => {
    askShare.current = () => {
      if (!report || !def) return;
      const run = async (format: 'csv' | 'pdf') => {
        setBusy(true);
        try {
          await exportReport(report, format, account?.farm_name ?? null);
        } catch {
          Alert.alert('Could not create the file', 'Try again.');
        } finally {
          setBusy(false);
        }
      };
      Alert.alert(
        'Share this report?',
        `The file contains your farm records${def.id === 'finance' ? ', including customer names and money owed' : ''}. Share it only with people and apps you trust.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'CSV (spreadsheet)', onPress: () => void run('csv') },
          { text: 'PDF', onPress: () => void run('pdf') },
        ],
      );
    };
  }, [report, def, account?.farm_name]);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (!def) return;
    navigation.setOptions({
      title: def.title,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <HeaderShare onPress={() => askShare.current()} busy={busy} disabled={backwards} />
          <SyncHeader />
        </View>
      ),
    });
  }, [navigation, def, busy, backwards]);

  if (!def || !report) return <MissingRecord what="report" message="There is no such report. Open Reports to choose one." />;
  const set = (patch: Partial<Filters>) => setFilters((x) => ({ ...x, ...patch }));
  const hasFilters = def.filters.length > 0 || def.id === 'finance';
  const activeFilters = [filters.cattleId, filters.breedId, filters.customerId, filters.method, filters.paid, filters.category].filter(Boolean).length;
  const shown = report.tables.filter((x) => x.rows.length);
  const empty = report.tables.filter((x) => !x.rows.length);

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
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
        </View>
        {hasFilters ? <FilterButton activeFilters={activeFilters} onPress={() => setShowFilters(true)} /> : null}
      </View>
      {period === 'custom' ? (
        <>
          <DateField label="From" value={custom.from} onChange={(d) => d && setCustom((c) => ({ ...c, from: d }))} optional={false} />
          <DateField label="To" value={custom.to} onChange={(d) => d && setCustom((c) => ({ ...c, to: d }))} optional={false} />
        </>
      ) : null}
      <FilterSheet visible={showFilters} onClose={() => setShowFilters(false)} onClear={activeFilters ? () => setFilters((x) => ({ currency: x.currency })) : undefined} showLabel="Show report">
        {def.filters.includes('animal') ? <ParentPicker label="Animal (optional)" value={filters.cattleId ?? null} animals={input.animals} onChange={(cattleId) => set({ cattleId })} /> : null}
        {def.filters.includes('breed') ? <Chips label="Breed" value={filters.breedId ?? null} options={input.breeds.map((b) => ({ value: b.id, label: b.name }))} onChange={(breedId) => set({ breedId })} /> : null}
        {def.id === 'finance' ? <Chips label="Currency" value={filters.currency} options={CURRENCIES} onChange={(currency) => currency && set({ currency })} allowClear={false} /> : null}
        {def.filters.includes('customer') ? <Chips label="Customer" value={filters.customerId ?? null} options={input.finance.customers.map((c) => ({ value: c.id, label: c.name }))} onChange={(customerId) => set({ customerId })} /> : null}
        {def.filters.includes('method') ? <Chips label="Payment method" value={filters.method ?? null} options={(Object.keys(METHOD_LABELS) as Method[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(method) => set({ method })} /> : null}
        {def.filters.includes('paid') ? <Chips label="Sale payment status" value={filters.paid ?? null} options={[{ value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' }]} onChange={(paid) => set({ paid })} /> : null}
        {def.filters.includes('category') ? <Chips label="Expense category" value={filters.category ?? null} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} onChange={(category) => set({ category })} /> : null}
      </FilterSheet>

      {backwards ? (
        <Notice tone="error">“From” is after “To”. Swap the dates to see the report.</Notice>
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Text accessibilityRole="header" style={{ color: t.text, ...type.sectionTitle }}>
              {rangeLabel(from, to)}
            </Text>
            {Object.keys(report.filters).length || sync.pending ? (
              <Text style={{ color: t.textMuted, ...type.caption }}>
                {[...Object.entries(report.filters).map(([k, v]) => `${k}: ${v}`), sync.pending ? `${sync.pending} not yet synced` : null].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {report.summary.map((s) => (
              <View
                key={s.label}
                style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: t.surface, borderRadius: radius.card, ...shadow, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: 2 }}
                accessible
                accessibilityLabel={`${s.label}: ${s.value}. ${s.note ?? ''}`}
              >
                <Text style={{ color: t.textMuted, ...type.micro }}>{s.label}</Text>
                <Text style={{ color: t.text, ...type.figure, fontVariant: ['tabular-nums'] }}>{s.value}</Text>
                {s.note ? <Text style={{ color: t.textMuted, ...type.micro }}>{s.note}</Text> : null}
              </View>
            ))}
          </View>
          {report.missing.map((m) => (
            <Notice key={m} tone="attention">
              {m}
            </Notice>
          ))}

          {shown.map((table) => (
            <ReportTable key={table.title} table={table} />
          ))}
          {empty.length ? (
            <Text style={{ color: t.textMuted, ...type.secondary }}>Nothing recorded for: {empty.map((x) => x.title.toLowerCase()).join(', ')}.</Text>
          ) : null}

          <Expander icon="calculator-variant-outline" label="How these figures are calculated" open={showHow} onToggle={() => setShowHow((v) => !v)} />
          {showHow ? (
            <Card gap={spacing.sm}>
              {report.definitions.map((d) => (
                <Text key={d} style={{ color: t.textMuted, ...type.secondary }}>
                  • {d}
                </Text>
              ))}
              <Text style={{ color: t.textMuted, ...type.caption }}>
                Units: {report.units}. Made {formatDateTime(report.generatedAt)} from records on this phone. Records made on another phone appear after they sync.
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
