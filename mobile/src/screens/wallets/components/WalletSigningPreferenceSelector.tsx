import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { KeyIcon, QrCodeIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Rows } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import type { WalletSigningPreference } from '@ledova/shared';

interface WalletSigningPreferenceSelectorProps {
  onSelect: (type: WalletSigningPreference) => void;
}

const WALLET_SIGNING_PREFERENCE_OPTIONS: {
  type: WalletSigningPreference;
  label: string;
  description: string;
  Icon: typeof KeyIcon;
}[] = [
  {
    type: 'software',
    label: 'Software Wallet',
    description: 'Generate a wallet on this device',
    Icon: KeyIcon,
  },
  {
    type: 'hardware',
    label: 'Hardware Wallet',
    description: 'Connect a hardware wallet via QR',
    Icon: QrCodeIcon,
  },
];

export function WalletSigningPreferenceSelector({ onSelect }: WalletSigningPreferenceSelectorProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.sm,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.smd,
      gap: theme.spacing.smd,
    },
    textContainer: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    optionLabel: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.primary,
    },
    optionDescription: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
  }));
  return (
    <View style={styles.container}>
      <Text style={text.muted}>Choose how to add your wallet</Text>

      <Rows>
        {WALLET_SIGNING_PREFERENCE_OPTIONS.map(({ type, label, description, Icon }) => (
          <TouchableOpacity key={type} style={styles.option} onPress={() => onSelect(type)} activeOpacity={0.7}>
            <Icon size={theme.icon.sizes.md} color={theme.colors.interactive.active} weight="regular" />
            <View style={styles.textContainer}>
              <Text style={styles.optionLabel}>{label}</Text>
              <Text style={styles.optionDescription}>{description}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </Rows>
    </View>
  );
}
