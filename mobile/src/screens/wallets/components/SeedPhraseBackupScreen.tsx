import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { ShieldWarningIcon, EyeSlashIcon } from 'phosphor-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { GradientBackground } from '../../../components/GradientBackground';
import { Panel } from '../../../components/panel';
import { Action } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { getSeedPhrase } from '../../../services/secureKeyStorage';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';

type SeedPhraseBackupRouteProp = RouteProp<WalletsStackParamList, 'SeedPhraseBackup'>;

type BackupState = 'authenticating' | 'visible' | 'hidden' | 'error';

const AUTO_HIDE_SECONDS = 60;

export function SeedPhraseBackupScreen() {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
    },
    content: {
      gap: theme.spacing.md,
    },
    errorTitle: {
      color: theme.colors.status.error.text,
    },
    warningText: {
      color: theme.colors.status.warning.text,
    },
    loadingText: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.muted,
    },
    countdown: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
    },
    wordGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: theme.spacing.sm,
    },
    wordItem: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '47%',
      gap: theme.spacing.sm,
    },
    wordIndex: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
      minWidth: 18,
    },
    wordText: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.primary,
    },
  }));
  const navigation = useNavigation();
  const route = useRoute<SeedPhraseBackupRouteProp>();
  const { seedIdentifier } = route.params;

  const [backupState, setBackupState] = useState<BackupState>('authenticating');
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_HIDE_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSeedPhrase = useCallback(async () => {
    setBackupState('authenticating');
    try {
      const mnemonic = await getSeedPhrase(seedIdentifier);
      if (!mnemonic) {
        navigation.goBack();
        return;
      }
      setWords(mnemonic.split(' '));
      setBackupState('visible');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve recovery phrase');
      setBackupState('error');
    }
  }, [seedIdentifier, navigation]);

  useEffect(() => {
    loadSeedPhrase();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setWords([]);
    };
  }, [loadSeedPhrase]);

  useEffect(() => {
    if (backupState === 'visible') {
      setCountdown(AUTO_HIDE_SECONDS);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setBackupState('hidden');
            setWords([]);
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [backupState]);

  const handleRevealAgain = useCallback(() => {
    loadSeedPhrase();
  }, [loadSeedPhrase]);

  const renderContent = () => {
    if (backupState === 'authenticating') {
      return (
        <View style={text.line}>
          <ActivityIndicator size="small" color={theme.colors.interactive.default} />
          <Text style={[styles.loadingText, text.lineText]}>Authenticating...</Text>
        </View>
      );
    }

    if (backupState === 'error') {
      return (
        <View style={text.line}>
          <ShieldWarningIcon size={theme.icon.sizes.md} color={theme.colors.status.error.icon} weight="fill" />
          <View style={[text.group, text.lineText]}>
            <Text accessibilityRole="header" style={[text.heading, styles.errorTitle]}>
              Unable to Load
            </Text>
            {error && <Text style={text.muted}>{error}</Text>}
          </View>
        </View>
      );
    }

    if (backupState === 'hidden') {
      return (
        <View style={text.line}>
          <EyeSlashIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} weight="regular" />
          <View style={[text.group, text.lineText]}>
            <Text accessibilityRole="header" style={text.heading}>
              Recovery Phrase Hidden
            </Text>
            <Text style={text.muted}>
              The phrase was automatically hidden for security. Authenticate again to reveal it.
            </Text>
          </View>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={text.line}>
          <ShieldWarningIcon size={theme.icon.sizes.md} color={theme.colors.status.warning.icon} weight="fill" />
          <Text style={[text.text, styles.warningText, text.lineText]}>
            Never share your recovery phrase. Anyone with these words can access your funds.
          </Text>
        </View>

        <Text style={styles.countdown}>Auto-hiding in {countdown}s</Text>

        <View style={styles.wordGrid}>
          {words.map((word, index) => (
            <View key={index} style={styles.wordItem}>
              <Text style={styles.wordIndex}>{index + 1}</Text>
              <Text style={styles.wordText}>{word}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  return (
    <GradientBackground>
      <View style={styles.container}>
        <Panel
          title="Recovery Phrase"
          actions={
            <>
              {backupState === 'hidden' && <Action label="Reveal Again" onPress={handleRevealAgain} />}
              <Action label="Done" primary onPress={() => navigation.goBack()} />
            </>
          }
        >
          {renderContent()}
        </Panel>
      </View>
    </GradientBackground>
  );
}
