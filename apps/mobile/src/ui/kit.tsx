import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, router } from 'expo-router';
import { Children, type ComponentProps, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { minTouch, radius, shadow, spacing, type, useCardBasis, useTheme } from './theme';
import type { Theme } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Which soft/strong colour pair tints an icon badge. */
export type Tint = 'green' | 'sky' | 'straw' | 'red';
const TINTS: Record<Tint, [keyof Theme, keyof Theme]> = {
  green: ['primary', 'primarySoft'],
  sky: ['info', 'infoSoft'],
  straw: ['attention', 'attentionSoft'],
  red: ['danger', 'dangerSoft'],
};

/** An icon in a soft rounded square. Decorative: the label next to it carries the meaning. */
export function IconBadge({ icon, tint = 'green', size = 40 }: { icon: IconName; tint?: Tint; size?: number }) {
  const t = useTheme();
  const [fg, bg] = TINTS[tint];
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t[bg], alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.55} color={t[fg]} />
    </View>
  );
}

/** Section heading with an optional link on the right ("See all"). */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
      <Text accessibilityRole="header" style={{ color: t.text, ...type.sectionTitle, flexShrink: 1 }}>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={12} style={{ minHeight: minTouch, justifyContent: 'center' }}>
          <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A white rounded card holding rows, with hairline separators between them. */
export function ListGroup({ children }: { children: ReactNode }) {
  const t = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.card, ...shadow }}>
      {rows.map((row, i) => (
        <View key={i}>
          {i ? <View style={{ height: 1, backgroundColor: t.border, marginLeft: 72 }} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

/** A tappable row: icon badge, title and subtitle, an optional value, and a chevron. */
export function ListRow({
  icon,
  tint,
  title,
  subtitle,
  value,
  valueTone,
  href,
  onPress,
  leading,
}: {
  icon?: IconName;
  tint?: Tint;
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: 'danger' | 'muted';
  href?: Href;
  onPress?: () => void;
  leading?: ReactNode;
}) {
  const t = useTheme();
  const go = onPress ?? (href ? () => router.push(href) : undefined);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, value, subtitle].filter(Boolean).join('. ')}
      onPress={go}
      style={({ pressed }) => ({
        minHeight: minTouch + 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm + 2,
        backgroundColor: pressed ? t.primarySoft : 'transparent',
      })}
    >
      {leading ?? (icon ? <IconBadge icon={icon} tint={tint} /> : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.text, ...type.cardTitle }}>{title}</Text>
        {subtitle ? <Text style={{ color: t.textMuted, ...type.secondary }}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={{ color: valueTone === 'danger' ? t.danger : valueTone === 'muted' ? t.textMuted : t.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], maxWidth: '40%', textAlign: 'right' }}>
          {value}
        </Text>
      ) : null}
      <MaterialCommunityIcons name="chevron-right" size={22} color={t.textMuted} importantForAccessibility="no" />
    </Pressable>
  );
}

/** A square-ish tile for the main actions of a screen: icon badge on top, a verb label below. */
export function ActionTile({ icon, tint, label, hint, href }: { icon: IconName; tint?: Tint; label: string; hint?: string; href: Href }) {
  const t = useTheme();
  const basis = useCardBasis();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => router.push(href)}
      style={({ pressed }) => ({
        flexBasis: basis,
        flexGrow: 1,
        minHeight: 96,
        padding: spacing.md,
        gap: spacing.sm,
        justifyContent: 'space-between',
        borderRadius: radius.card,
        backgroundColor: pressed ? t.primarySoft : t.surface,
        ...shadow,
      })}
    >
      <IconBadge icon={icon} tint={tint} />
      <Text style={{ color: t.text, ...type.cardTitle }}>{label}</Text>
    </Pressable>
  );
}

/** A summary figure: label with icon, a large value with its unit, and a short note. Tappable when it has details. */
export function StatCard({
  icon,
  tint = 'green',
  label,
  value,
  note,
  href,
  alert,
}: {
  icon: IconName;
  tint?: Tint;
  label: string;
  value: string;
  note?: string;
  href?: Href;
  alert?: boolean;
}) {
  const t = useTheme();
  const basis = useCardBasis();
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <IconBadge icon={icon} tint={alert ? 'red' : tint} size={30} />
        <Text style={{ color: t.textMuted, fontSize: 14, flexShrink: 1 }}>{label}</Text>
      </View>
      <Text style={{ color: alert ? t.danger : t.text, fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {note ? <Text style={{ color: alert ? t.danger : t.textMuted, fontSize: 13 }}>{note}</Text> : null}
    </>
  );
  const style = {
    flexBasis: basis,
    flexGrow: 1,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.card,
    borderWidth: alert ? 1 : 0,
    borderColor: t.danger,
    backgroundColor: t.surface,
    ...shadow,
  } as const;
  const label_ = `${label}: ${value}${note ? `. ${note}` : ''}`;
  return href ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label_} accessibilityHint="Opens the details" onPress={() => router.push(href)} style={({ pressed }) => [style, pressed && { backgroundColor: t.primarySoft }]}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label_} style={style}>
      {body}
    </View>
  );
}

/** Two-letter initials in a soft circle, for animals and customers without a photo. */
export function Avatar({ name, tint = 'green', size = 44 }: { name: string; tint?: Tint; size?: number }) {
  const t = useTheme();
  const [fg, bg] = TINTS[tint];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t[bg], alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t[fg], fontSize: size * 0.38, fontWeight: '600' }} maxFontSizeMultiplier={1.2}>
        {initials || '?'}
      </Text>
    </View>
  );
}

/** A small status label: words always, colour as support. */
export function Pill({ label, tint = 'green' }: { label: string; tint?: Tint }) {
  const t = useTheme();
  const [fg, bg] = TINTS[tint];
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.chip, backgroundColor: t[bg] }}>
      <Text style={{ color: t[fg], fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/** A plain white card for grouped content. With `href` the whole card opens that screen. */
export function Card({ children, gap = spacing.md, href, label }: { children: ReactNode; gap?: number; href?: Href; label?: string }) {
  const t = useTheme();
  const style = { backgroundColor: t.surface, borderRadius: radius.card, padding: spacing.md, gap, ...shadow };
  if (!href) return <View style={style}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the details" onPress={() => router.push(href)} style={({ pressed }) => [style, pressed && { backgroundColor: t.primarySoft }]}>
      {children}
    </Pressable>
  );
}

/** Figures laid out three to a row (two with large text), so a card can hold a handful of numbers calmly. */
export function FigureRow({ children }: { children: ReactNode }) {
  const basis = useCardBasis();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.md }}>
      {Children.toArray(children)
        .filter(Boolean)
        .map((c, i) => (
          <View key={i} style={{ flexBasis: basis === '100%' ? '45%' : '28%', flexGrow: 1 }}>
            {c}
          </View>
        ))}
    </View>
  );
}

/** A labelled figure inside a card: small label above, the number below. */
export function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'danger' }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ''}`}>
      <Text style={{ color: t.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: tone === 'danger' ? t.danger : t.text, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {note ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{note}</Text> : null}
    </View>
  );
}

/** The headline of a detail page: a small label, one large value, and an optional note or status pill. */
export function Hero({ label, value, note, tone, pill }: { label: string; value: string; note?: string; tone?: 'danger' | 'muted'; pill?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.card, padding: spacing.md, gap: 2, ...shadow }} accessible accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ''}`}>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: tone === 'danger' ? t.danger : tone === 'muted' ? t.textMuted : t.text, fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {note ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{note}</Text> : null}
      {pill ? <View style={{ marginTop: spacing.xs }}>{pill}</View> : null}
    </View>
  );
}

/** Label/value pairs in a card, with hairlines between them. Empty values are left out. */
export function Details({ rows }: { rows: [label: string, value: string | null | undefined, tone?: 'danger'][] }) {
  const t = useTheme();
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.card, paddingHorizontal: spacing.md, ...shadow }}>
      {shown.map(([label, value, tone], i) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}: ${value}`}
          style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm + 4, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
        >
          <Text style={{ color: t.textMuted, fontSize: 15, width: 120 }}>{label}</Text>
          <Text style={{ color: tone === 'danger' ? t.danger : t.text, fontSize: 15, flex: 1, textAlign: 'right' }}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/** A titled white card holding a small form (correct, void, reverse…), so it reads as one step. */
export function FormCard({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.card, padding: spacing.md, gap: spacing.md, ...shadow }}>
      {title ? <Text style={{ color: t.text, ...type.cardTitle, fontSize: 17 }}>{title}</Text> : null}
      {children}
    </View>
  );
}
