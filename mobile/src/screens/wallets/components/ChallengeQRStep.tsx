import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { QRDisplay } from '../../../components/qr';
import { useDialogStyles } from '../../../components/modal';
import { useAppTheme, useThemedStyles } from '../../../contexts';

interface ChallengeQRStepProps {
  urEncodedChallenge: string | null;
}

export function ChallengeQRStep({ urEncodedChallenge }: ChallengeQRStepProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    loading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
  }));
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={text.heading}>
        Scan Challenge QR
      </Text>

      {urEncodedChallenge ? (
        <QRDisplay data={urEncodedChallenge} isUR={true} />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={theme.colors.interactive.default} />
          <Text style={text.muted}>Generating challenge QR...</Text>
        </View>
      )}
    </View>
  );
}
