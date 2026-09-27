import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { loadAsync } from 'expo-font';
import { PAPER_THEME } from '@ledova/shared';
import Newsreader from '../../assets/fonts/Newsreader_500Medium.ttf';
import InstrumentSans from '../../assets/fonts/InstrumentSans_400Regular.ttf';
import InstrumentSansMedium from '../../assets/fonts/InstrumentSans_500Medium.ttf';
import InstrumentSansSemibold from '../../assets/fonts/InstrumentSans_600SemiBold.ttf';
import InstrumentSansBold from '../../assets/fonts/InstrumentSans_700Bold.ttf';

const FONTS = {
  Newsreader_500Medium: Newsreader,
  InstrumentSans_400Regular: InstrumentSans,
  InstrumentSans_500Medium: InstrumentSansMedium,
  InstrumentSans_600SemiBold: InstrumentSansSemibold,
  InstrumentSans_700Bold: InstrumentSansBold,
};

export function AppFonts({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    const timeout = setTimeout(() => {
      active = false;
      setStatus('failed');
    }, 20000);
    void loadAsync(FONTS).then(
      () => {
        if (active) setStatus('ready');
        clearTimeout(timeout);
      },
      () => {
        if (active) setStatus('failed');
        clearTimeout(timeout);
      },
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [attempt]);

  if (status === 'ready') return children;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: PAPER_THEME.surface.base,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {status === 'loading' ? (
        <>
          <ActivityIndicator color={PAPER_THEME.brand.default} />
          <Text style={{ color: PAPER_THEME.text.primary }}>Opening Ledova…</Text>
        </>
      ) : (
        <>
          <Text accessibilityRole="alert" style={{ color: PAPER_THEME.text.primary }}>
            We couldn&apos;t load the app&apos;s fonts.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((value) => value + 1)}
            style={{ padding: 12 }}
          >
            <Text style={{ color: PAPER_THEME.brand.default }}>Try again</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
