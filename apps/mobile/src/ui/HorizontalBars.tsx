import { Text, View } from 'react-native';
import { spacing, useTheme } from './theme';

/** Ranked single-series bars (e.g. milk by cow), each labelled with its value. */
export function HorizontalBars({ title, items, format, limit = 10 }: { title: string; items: { key: string; label: string; value: number }[]; format: (v: number) => string; limit?: number }) {
  const t = useTheme();
  const shown = [...items].sort((a, b) => b.value - a.value).slice(0, limit);
  const max = Math.max(0, ...shown.map((i) => i.value));
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>{title}</Text>
      {shown.length === 0 ? <Text style={{ color: t.textMuted }}>No records in this period.</Text> : null}
      {shown.map((i) => (
        <View key={i.key} accessible accessibilityLabel={`${i.label}: ${format(i.value)}`} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: t.text, fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
              {i.label}
            </Text>
            <Text style={{ color: t.text, fontSize: 14, fontVariant: ['tabular-nums'] }}>{format(i.value)}</Text>
          </View>
          <View style={{ height: 8, backgroundColor: t.surface, borderRadius: 4 }}>
            <View style={{ height: 8, width: `${max ? (i.value / max) * 100 : 0}%`, backgroundColor: t.chart, borderRadius: 4 }} />
          </View>
        </View>
      ))}
      {items.length > limit ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Top {limit} of {items.length}. See the production report for all cows.</Text> : null}
    </View>
  );
}
