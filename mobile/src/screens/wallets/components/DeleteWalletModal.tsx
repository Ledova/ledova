import { Action } from '../../../components/Ledger';
import React from 'react';
import { View, Text } from 'react-native';
import { TrashIcon } from 'phosphor-react-native';
import { CustomModal } from '../../../components/modal';
import { useAppTheme, useThemedStyles } from '../../../contexts';

interface DeleteWalletModalProps {
  visible: boolean;
  walletName: string;
  onConfirm: () => void;
  pending?: boolean;
  blocked?: boolean;
  error?: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function DeleteWalletModal({
  visible,
  walletName,
  onConfirm,
  onClose,
  onRetry,
  pending = false,
  blocked = false,
  error,
}: DeleteWalletModalProps) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    headerContainer: {
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
    },
    icon: {
      marginBottom: theme.spacing.md,
    },
    title: {
      fontSize: theme.fontSize.xl,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.sm,
      textAlign: 'center',
    },
    message: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      textAlign: 'center',
    },
    walletNameHighlight: {
      color: theme.colors.text.primary,
      fontWeight: theme.fontWeight.semibold,
    },
  }));
  return (
    <CustomModal
      visible={visible}
      onClose={() => {
        if (!pending) onClose();
      }}
      showFooter={true}
      cancelLabel="Cancel"
      confirmLabel="Delete"
      onConfirm={() => {
        if (!pending && !blocked) onConfirm();
      }}
      confirmLoading={pending}
      confirmDisabled={pending || blocked}
    >
      {error && (
        <Text accessibilityRole="alert" style={styles.message}>
          {error}
        </Text>
      )}
      {blocked && <Text style={styles.message}>Refresh wallets before continuing. Your selection is kept.</Text>}
      {blocked && <Action label="Retry wallets" disabled={pending} onPress={onRetry} />}
      <View style={styles.headerContainer}>
        <TrashIcon
          size={theme.icon.sizes.xxl}
          color={theme.colors.status.error.icon}
          weight={theme.icon.weights.regular}
          style={styles.icon}
        />

        <Text style={styles.title}>Delete Wallet</Text>
        <Text style={styles.message}>
          Are you sure you want to delete <Text style={styles.walletNameHighlight}>{walletName}</Text>? This action
          cannot be undone.
        </Text>
      </View>
    </CustomModal>
  );
}
