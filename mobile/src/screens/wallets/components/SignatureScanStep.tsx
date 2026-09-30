import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { ScannerPreview, type ScannerPreviewProps } from '../../../components/qr/ScannerPreview';
import type { CameraMessage } from '../../../components/qr/useCameraScanner';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useDialogStyles } from '../../../components/modal';
import { VerificationError, VerificationSuccess } from './VerificationInstructions';

interface SignatureScanStepProps {
  cameraMessage: CameraMessage | null;
  isVerifying: boolean;
  verificationSuccess: boolean;
  verificationError: string | null;
  preview: ScannerPreviewProps;
}

export function SignatureScanStep({
  cameraMessage,
  isVerifying,
  verificationSuccess,
  verificationError,
  preview,
}: SignatureScanStepProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    cameraContainer: {
      width: '100%',
      height: 280,
      borderRadius: theme.borderRadius.lg,
      overflow: 'hidden',
      backgroundColor: theme.colors.utility.black,
      position: 'relative',
    },
    cameraMessage: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.xl,
    },
    cameraMessageText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      textAlign: 'center',
    },
    cameraOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scanArea: {
      width: 220,
      height: 220,
      borderWidth: 2,
      borderColor: theme.colors.interactive.active,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.utility.transparent,
    },
  }));
  if (verificationSuccess) {
    return (
      <View style={styles.container}>
        <VerificationSuccess />
      </View>
    );
  }

  if (isVerifying) {
    return (
      <View style={styles.container}>
        <View style={text.line}>
          <ActivityIndicator size="small" color={theme.colors.interactive.default} />
          <Text style={[text.muted, text.lineText]}>Verifying signature...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={text.heading}>
        Scan Signature QR
      </Text>

      <View style={styles.cameraContainer}>
        <ScannerPreview {...preview} />
        {cameraMessage ? (
          <View style={styles.cameraMessage}>
            <Text style={styles.cameraMessageText} accessibilityLabel={cameraMessage.label}>
              {cameraMessage.text}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.cameraOverlay}>
              <View style={styles.scanArea} />
            </View>
          </>
        )}
      </View>

      {verificationError && <VerificationError message={verificationError} />}
    </View>
  );
}
