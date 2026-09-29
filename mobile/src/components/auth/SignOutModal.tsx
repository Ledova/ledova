import React from 'react';
import { Text } from 'react-native';
import { CustomModal, useDialogStyles } from '../modal';

interface SignOutModalProps {
  visible: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function SignOutModal({ visible, isLoading = false, onConfirm, onClose }: SignOutModalProps) {
  const styles = useDialogStyles();
  return (
    <CustomModal
      visible={visible}
      title="Sign Out"
      onClose={onClose}
      showFooter={true}
      confirmLabel="Sign Out"
      onConfirm={onConfirm}
      confirmLoading={isLoading}
      confirmDisabled={isLoading}
    >
      <Text style={styles.muted}>
        Are you sure you want to sign out? You will need to sign in again to access your account.
      </Text>
    </CustomModal>
  );
}
