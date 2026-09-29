import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { CheckCircleIcon, ArrowSquareOutIcon } from 'phosphor-react-native';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { getBlockchainDisplayName, getBlockExplorerTxUrl } from '@ledova/shared';

interface SuccessModalProps {
  visible: boolean;
  txHash: string | null;
  chainShortName: string;
  onDone: () => void;
}

export function SuccessModal({ visible, txHash, chainShortName, onDone }: SuccessModalProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    success: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    successText: {
      flex: 1,
    },
    hash: {
      gap: theme.spacing.xs,
      paddingTop: theme.spacing.smd,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
    hashValue: {
      fontSize: theme.fontSize.xs,
      fontFamily: 'monospace',
      color: theme.colors.text.primary,
    },
    explorerLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.xs,
    },
    explorerText: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.interactive.active,
    },
  }));
  const handleOverlayClose = () => {};
  const explorerUrl = txHash ? getBlockExplorerTxUrl(chainShortName, txHash) : '';

  return (
    <CustomModal
      visible={visible}
      title="Transaction Sent"
      onClose={handleOverlayClose}
      showFooter={true}
      showCancelButton={false}
      confirmLabel="Done"
      onConfirm={onDone}
    >
      <View style={styles.success}>
        <CheckCircleIcon size={theme.icon.sizes.md} color={theme.colors.status.success.icon} weight="fill" />
        <Text style={[text.muted, styles.successText]}>
          Your transaction is being processed by the {getBlockchainDisplayName(chainShortName)} network
        </Text>
      </View>

      {txHash && (
        <View style={styles.hash}>
          <Text accessibilityRole="header" style={text.heading}>
            Transaction Hash
          </Text>
          <Text style={styles.hashValue} numberOfLines={1} ellipsizeMode="middle">
            {txHash}
          </Text>
          {explorerUrl ? (
            <TouchableOpacity style={styles.explorerLink} onPress={() => Linking.openURL(explorerUrl)}>
              <Text style={styles.explorerText}>View on block explorer</Text>
              <ArrowSquareOutIcon size={theme.icon.sizes.sm} color={theme.colors.interactive.active} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </CustomModal>
  );
}
