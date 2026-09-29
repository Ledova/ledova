import { Action } from '../../../components/Ledger';
import React from 'react';
import { Text } from 'react-native';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { useThemedStyles } from '../../../contexts';

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
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    walletNameHighlight: {
      fontFamily: theme.fontFamily.semibold,
      color: theme.colors.text.primary,
    },
  }));
  return (
    <CustomModal
      visible={visible}
      title="Delete Wallet"
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
        <Text accessibilityRole="alert" style={text.error}>
          {error}
        </Text>
      )}
      {blocked && <Text style={text.muted}>Refresh wallets before continuing. Your selection is kept.</Text>}
      {blocked && <Action label="Retry wallets" disabled={pending} onPress={onRetry} />}
      <Text style={text.muted}>
        Are you sure you want to delete <Text style={styles.walletNameHighlight}>{walletName}</Text>? This action cannot
        be undone.
      </Text>
    </CustomModal>
  );
}
