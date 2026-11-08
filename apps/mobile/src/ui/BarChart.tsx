import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { minTouch, spacing, type, useTheme } from './theme';

export interface Bar {
  key: string;
  label: string; // full label for tooltips and the table, e.g. "Tue 21 Oct"
  short: string; // axis label, e.g. "21"
  value: number;
  missing?: boolean; // no records that day: shown as a gap, not as zero
}

/**
 * Single-series bar chart: one validated hue, thin bars with 2px gaps and 4px rounded tops
 * on a shared baseline, the peak labelled directly. Tap a bar to read it; a table view lists
 * every value for screen readers and exact reading.
 */
export function BarChart({
  title,
  bars,
  format,
  height = 140,
  max: sharedMax,
}: {
  title: string;
  bars: Bar[];
  format: (v: number) => string;
  height?: number;
  /** Use the same scale across small charts that are compared side by side. */
  max?: number;
}) {
  const t = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const max = sharedMax ?? Math.max(0, ...bars.map((b) => b.value));
  const top = Math.max(0, ...bars.map((b) => b.value));
  const peak = bars.find((b) => b.value === top && top > 0);
  const recorded = bars.filter((b) => !b.missing);
  const summary = recorded.length
    ? `${title}. ${recorded.length} of ${bars.length} days recorded. Highest ${format(top)} on ${peak?.label}.`
    : `${title}. No records in this period.`;
  const shown = bars.find((b) => b.key === selected) ?? peak;
  const axisEvery = Math.max(1, Math.ceil(bars.length / 7));

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text style={{ color: t.text, ...type.cardTitle, flexShrink: 1 }}>{title}</Text>
        {/* Small and out of the way, but still a full-size touch target. */}
        <Pressable accessibilityRole="button" onPress={() => setTable((v) => !v)} hitSlop={12} style={{ minHeight: minTouch - 8, justifyContent: 'center' }}>
          <Text style={{ color: t.primary, ...type.secondary, fontWeight: '600' }}>{table ? 'Chart' : 'Table'}</Text>
        </Pressable>
      </View>
      <Text style={{ color: t.textMuted, ...type.bodySmall }} accessibilityLiveRegion="polite">
        {shown ? `${shown.label}: ${shown.missing ? 'no records' : format(shown.value)}${shown === peak && !selected ? ' (highest)' : ''}` : 'No records in this period'}
      </Text>

      {table ? (
        <View accessibilityRole="list">
          {bars.map((b) => (
            <View key={b.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: t.border }}>
              <Text style={{ color: t.text, ...type.bodySmall }}>{b.label}</Text>
              <Text style={{ color: t.text, ...type.bodySmall, fontVariant: ['tabular-nums'] }}>{b.missing ? '—' : format(b.value)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View accessible accessibilityLabel={summary} accessibilityHint="Use Table to hear each value">
          <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, borderBottomColor: t.border }}>
            {bars.map((b) => {
              const active = b.key === shown?.key;
              return (
                // The hit target is the full column height, larger than the bar itself.
                <Pressable
                  key={b.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.label}: ${b.missing ? 'no records' : format(b.value)}`}
                  onPress={() => setSelected(b.key)}
                  style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
                >
                  {b.missing ? null : (
                    <View
                      style={{
                        height: max ? Math.max(2, (b.value / max) * (height - 4)) : 0,
                        width: '72%',
                        maxWidth: 32,
                        alignSelf: 'center',
                        backgroundColor: t.chart,
                        opacity: shown && !active ? 0.55 : 1,
                        borderTopLeftRadius: 4,
                        borderTopRightRadius: 4,
                      }}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {bars.map((b, i) => (
              <Text key={b.key} style={{ flex: 1, textAlign: 'center', color: t.textMuted, ...type.micro }} numberOfLines={1}>
                {i % axisEvery === 0 ? b.short : ''}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
