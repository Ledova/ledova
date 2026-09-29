import { Action, Row, Rows } from '../../../components/Ledger';
import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { getBlockchainDisplayName, getChainShortCode } from '@ledova/shared';
import type { Wallet, DerivedAddress } from '@ledova/shared';
import { deriveAddressFromParentKey } from '../../../utils/keystone/bcurDecoder';

interface DeriveAddressModalProps {
  visible: boolean;
  wallet: Wallet | null;
  onConfirm: (derivedAddress: DerivedAddress) => void;
  onClose: () => void;
  onRetry: () => void;
  isCreating?: boolean;
  blocked?: boolean;
  createError?: string | null;
}

export function DeriveAddressModal({
  visible,
  wallet,
  onConfirm,
  onClose,
  onRetry,
  isCreating = false,
  blocked = false,
  createError,
}: DeriveAddressModalProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    block: {
      gap: theme.spacing.xs,
      paddingVertical: 10,
    },
    label: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
    addressValue: {
      fontSize: theme.fontSize.sm,
      fontFamily: theme.fontFamily.mono,
      color: theme.colors.text.primary,
    },
    pathValue: {
      fontSize: theme.fontSize.xs,
      fontFamily: theme.fontFamily.mono,
      color: theme.colors.text.secondary,
    },
    loading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    info: {
      flex: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.secondary,
    },
  }));
  const [derivedAddress, setDerivedAddress] = useState<DerivedAddress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && wallet?.parentPublicKey && wallet?.parentChainCode && wallet?.parentDerivationPath) {
      try {
        const nextIndex = (wallet.addressIndex ?? 0) + 1;
        const newAddress = deriveAddressFromParentKey(
          wallet.parentPublicKey,
          wallet.parentChainCode,
          wallet.parentDerivationPath,
          nextIndex,
        );
        setDerivedAddress(newAddress);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to derive address');
        setDerivedAddress(null);
      }
    } else {
      setDerivedAddress(null);
      setError(null);
    }
  }, [visible, wallet]);

  const handleConfirm = () => {
    if (derivedAddress && !isCreating && !blocked) {
      onConfirm(derivedAddress);
    }
  };

  if (!wallet) return null;

  const networkName = getBlockchainDisplayName(getChainShortCode(wallet.chain));

  return (
    <CustomModal
      visible={visible}
      title="Derive New Address"
      onClose={() => {
        if (!isCreating) onClose();
      }}
      showFooter={true}
      cancelLabel="Cancel"
      confirmLabel={isCreating ? 'Adding...' : 'Add Address'}
      onConfirm={handleConfirm}
      confirmDisabled={!derivedAddress || isCreating || blocked}
      confirmLoading={isCreating}
    >
      {createError && (
        <Text accessibilityRole="alert" style={text.error}>
          {createError}
        </Text>
      )}
      {blocked && <Text style={text.muted}>Refresh wallets before continuing. Your selection is kept.</Text>}
      {blocked && <Action label="Retry wallets" disabled={isCreating} onPress={onRetry} />}
      <Text style={text.muted}>
        {wallet.signingPreference === 'software'
          ? 'Add another address from your software wallet'
          : 'Add another address from your hardware wallet'}
      </Text>

      {error ? (
        <Text style={text.error}>{error}</Text>
      ) : derivedAddress ? (
        <>
          <Rows>
            <Row label="Network">{networkName}</Row>
            <Row label="Address Index">{derivedAddress.addressIndex}</Row>
            <View style={styles.block}>
              <Text style={styles.label}>New Address</Text>
              <Text style={styles.addressValue} numberOfLines={2}>
                {derivedAddress.address}
              </Text>
            </View>
            <View style={styles.block}>
              <Text style={styles.label}>Derivation Path</Text>
              <Text style={styles.pathValue}>{derivedAddress.derivationPath}</Text>
            </View>
          </Rows>

          <View style={text.line}>
            <CheckCircleIcon size={theme.icon.sizes.sm} color={theme.colors.status.info.icon} weight="fill" />
            <Text style={styles.info}>
              {wallet.signingPreference === 'software'
                ? 'This address is derived from the same recovery phrase as your existing wallet'
                : 'This address shares the same master fingerprint as your existing wallet'}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={theme.colors.interactive.default} />
          <Text style={text.muted}>Deriving address...</Text>
        </View>
      )}
    </CustomModal>
  );
}
