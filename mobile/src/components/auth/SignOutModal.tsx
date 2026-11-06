import React from 'react';
import { Text } from 'react-native';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { Action } from '../Ledger';
import { CustomModal } from '../modal';

interface SignOutModalProps {
  visible: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function SignOutModal({ visible, isLoading = false, onConfirm, onClose }: SignOutModalProps) {
  const styles = useCompanyStyles();
  return (
    <CustomModal
      visible={visible}
      title="Sign out"
      onClose={onClose}
      busy={isLoading}
      actions={
        <Action label={isLoading ? 'Signing out…' : 'Sign out'} primary disabled={isLoading} onPress={onConfirm} />
      }
    >
      <Text style={styles.muted}>
        Are you sure you want to sign out? You will need to sign in again to access your account.
      </Text>
    </CustomModal>
  );
}
