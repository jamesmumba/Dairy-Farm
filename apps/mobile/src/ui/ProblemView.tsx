import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { runSync } from '../sync/engine';
import { Button } from './form';
import { IconBadge, type IconName, type Tint } from './kit';
import { spacing, type, useTheme } from './theme';

// Whole-screen messages for when a screen cannot show what was asked for: a crash, a link to nowhere,
// a record that is no longer on this phone. Always says what happened, that saved records are safe,
// and gives a way forward.

/** Back where the farmer came from, or Home when there is nowhere to go back to. */
export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function ProblemView({
  icon,
  tint = 'straw',
  title,
  message,
  details,
  children,
}: {
  icon: IconName;
  tint?: Tint;
  title: string;
  message: string;
  /** Technical text, hidden until asked for. */
  details?: string;
  /** The buttons. */
  children: ReactNode;
}) {
  const t = useTheme();
  const [showDetails, setShowDetails] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon={icon} tint={tint} size={64} />
          <Text accessibilityRole="header" style={{ color: t.text, ...type.screenTitle, textAlign: 'center' }}>
            {title}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 16, textAlign: 'center' }}>{message}</Text>
        </View>
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>{children}</View>
        {details ? (
          <>
            <Button label={showDetails ? 'Hide details' : 'Show details'} variant="link" onPress={() => setShowDetails(!showDetails)} />
            {showDetails ? (
              <Text selectable style={{ color: t.textMuted, fontSize: 13, fontFamily: 'monospace' }}>
                {details}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

/**
 * A record that is not on this phone: deleted on another phone, not synced here yet, or an old link.
 * Offers to check the account for changes, then to go back.
 */
export function MissingRecord({ what, message }: { what: string; message?: string }) {
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      await runSync();
    } finally {
      setChecking(false);
    }
  }
  return (
    <ProblemView
      icon="file-question-outline"
      title={`${what[0].toUpperCase()}${what.slice(1)} not found`}
      message={message ?? `This ${what} is not on this phone. It may have been removed on another phone, or not reached this phone yet.`}
    >
      <Button label="Check for changes" onPress={check} busy={checking} />
      <Button label="Go back" variant="secondary" onPress={goBackOrHome} />
    </ProblemView>
  );
}
