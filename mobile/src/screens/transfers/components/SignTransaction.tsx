import React from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { QRDisplay } from '../../../components/qr';
import { useDialogStyles } from '../../../components/modal';
import { useAppTheme, useThemedStyles } from '../../../contexts';

interface SignTransactionProps {
  urEncodedTransaction: string | null;
  error?: string | null;
}

export function SignTransaction({ urEncodedTransaction, error = null }: SignTransactionProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      gap: theme.spacing.md,
    },
    sectionTitle: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.secondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      textAlign: 'center',
    },
    qrContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.sm,
      minHeight: 200,
    },
    qrLoading: {
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    dividerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: theme.colors.border.subtle,
    },
    dividerText: {
      marginHorizontal: theme.spacing.md,
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
    },
  }));
  return (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.scrollContentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Scan with your Wallet
      </Text>
      <View style={styles.qrContainer}>
        {urEncodedTransaction ? (
          <QRDisplay data={urEncodedTransaction} isUR />
        ) : error ? (
          <Text style={text.error}>{error}</Text>
        ) : (
          <View style={styles.qrLoading}>
            <ActivityIndicator size="small" color={theme.colors.interactive.active} />
            <Text style={text.muted}>Generating QR code...</Text>
          </View>
        )}
      </View>

      <View style={styles.dividerContainer}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>then scan signature</Text>
        <View style={styles.dividerLine} />
      </View>

      <Text style={text.muted}>
        After signing the transaction on your hardware wallet, scan the signature QR code using the button below.
      </Text>
    </ScrollView>
  );
}
