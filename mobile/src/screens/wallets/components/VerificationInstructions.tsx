import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { CheckCircleIcon, WarningCircleIcon, ShieldCheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useDialogStyles } from '../../../components/modal';

interface VerificationInstructionsProps {
  isSoftwareWallet: boolean;
  isRequestingChallenge: boolean;
  isVerifying: boolean;
  verificationSuccess: boolean;
  verificationError: string | null;
}

const STEPS = [
  "We'll generate a unique verification challenge",
  'Scan the challenge QR with your hardware wallet',
  'Review and sign the message on your device',
  'Scan the signature QR back to the app',
  'Your wallet will be verified!',
];

export function VerificationError({ message }: { message: string }) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  return (
    <View style={text.line}>
      <WarningCircleIcon
        size={theme.icon.sizes.md}
        color={theme.colors.status.error.icon}
        weight={theme.icon.weights.regular}
      />
      <Text style={[text.error, text.lineText]}>{message}</Text>
    </View>
  );
}

export function VerificationSuccess() {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    title: { color: theme.colors.status.success.text },
  }));
  return (
    <View style={text.line}>
      <CheckCircleIcon size={theme.icon.sizes.md} weight="fill" color={theme.colors.status.success.icon} />
      <View style={[text.group, text.lineText]}>
        <Text accessibilityRole="header" style={[text.heading, styles.title]}>
          Verification Successful!
        </Text>
        <Text style={text.muted}>Your wallet ownership has been verified.</Text>
      </View>
    </View>
  );
}

export function VerificationInstructions({
  isSoftwareWallet,
  isRequestingChallenge,
  isVerifying,
  verificationSuccess,
  verificationError,
}: VerificationInstructionsProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
  }));
  if (isSoftwareWallet) {
    return (
      <View style={styles.container}>
        {verificationSuccess ? (
          <VerificationSuccess />
        ) : isRequestingChallenge || isVerifying ? (
          <View style={text.line}>
            <ActivityIndicator size="small" color={theme.colors.interactive.default} />
            <Text style={[text.heading, text.lineText]}>Verifying...</Text>
          </View>
        ) : (
          <View style={text.line}>
            <ShieldCheckIcon
              size={theme.icon.sizes.md}
              color={theme.colors.status.info.icon}
              weight={theme.icon.weights.regular}
            />
            <Text style={[text.heading, text.lineText]}>Verify Wallet</Text>
          </View>
        )}
        {verificationError && <VerificationError message={verificationError} />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={text.muted}>Verify Wallet Ownership</Text>

      <View style={text.group}>
        <Text accessibilityRole="header" style={text.heading}>
          How verification works:
        </Text>
        {STEPS.map((step, index) => (
          <Text key={step} style={text.text}>
            {index + 1}. {step}
          </Text>
        ))}
      </View>

      {verificationError && <VerificationError message={verificationError} />}
    </View>
  );
}
