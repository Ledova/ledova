import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { FingerprintSimpleIcon, CheckCircleIcon, WarningCircleIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Row, Rows } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import type { Wallet, TransactionData } from '@ledova/shared';
import { getSeedPhrase } from '../../../services/secureKeyStorage';
import { signEthereumTransaction } from '../../../utils/softwareWallet';
import { preparedTransferTransaction } from '../../../utils/preparedTransfer';
import { formatWalletAddressShort } from '@ledova/shared';

interface SoftwareSignTransactionProps {
  wallet: Wallet;
  transactionData: TransactionData;
  onSignComplete: (signedTxHex: string) => void;
  signTrigger?: number;
}

type SigningState = 'ready' | 'authenticating' | 'signing' | 'success' | 'error';

export function SoftwareSignTransaction({
  wallet,
  transactionData,
  onSignComplete,
  signTrigger = 0,
}: SoftwareSignTransactionProps) {
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
    },
    successTitle: {
      color: theme.colors.status.success.text,
    },
    errorTitle: {
      color: theme.colors.status.error.text,
    },
  }));
  const [signingState, setSigningState] = useState<SigningState>('ready');
  const [error, setError] = useState<string | null>(null);

  const handleSign = useCallback(async () => {
    if (!wallet.derivationPath || !wallet.masterFingerprint) {
      setError('Missing derivation path. Cannot sign this transaction.');
      setSigningState('error');
      return;
    }

    try {
      const unsignedTx = preparedTransferTransaction(transactionData.transaction);

      const isNativeTransfer = unsignedTx.data === '0x' || unsignedTx.data === '0x00';
      if (isNativeTransfer && transactionData.toAddress) {
        if (unsignedTx.to.toLowerCase() !== transactionData.toAddress.toLowerCase()) {
          throw new Error('Transaction recipient does not match expected address');
        }
      }

      setSigningState('authenticating');
      setError(null);

      const seedId = wallet.masterFingerprint;
      const mnemonic = await getSeedPhrase(seedId);
      if (!mnemonic) {
        setSigningState('ready');
        return;
      }

      setSigningState('signing');

      const signedTx = await signEthereumTransaction(mnemonic, wallet.derivationPath, unsignedTx);

      setSigningState('success');

      setTimeout(() => {
        onSignComplete(signedTx);
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign transaction');
      setSigningState('error');
    }
  }, [wallet, transactionData, onSignComplete]);

  useEffect(() => {
    if (signTrigger > 0) {
      handleSign();
    }
  }, [signTrigger]);

  const size = theme.icon.sizes.md;

  return (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.scrollContentContainer}
      showsVerticalScrollIndicator={false}
    >
      <View style={text.group}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Transaction Summary
        </Text>
        <Rows>
          <Row label="From" mono>
            {formatWalletAddressShort(transactionData.fromAddress)}
          </Row>
          <Row label="To" mono>
            {formatWalletAddressShort(transactionData.toAddress)}
          </Row>
          {transactionData.amountEth && (
            <Row label="Amount" mono>
              {transactionData.amountEth} ETH
            </Row>
          )}
          {transactionData.gasCostEth && (
            <Row label="Gas" mono>
              {transactionData.gasCostEth} ETH
            </Row>
          )}
        </Rows>
      </View>

      {signingState === 'ready' && (
        <View style={text.line}>
          <FingerprintSimpleIcon size={size} color={theme.colors.interactive.active} weight="regular" />
          <View style={[text.group, text.lineText]}>
            <Text accessibilityRole="header" style={text.heading}>
              Ready to Sign
            </Text>
            <Text style={text.muted}>
              Tap &quot;Sign &amp; Send&quot; below to authenticate and sign this transaction with your software wallet.
            </Text>
          </View>
        </View>
      )}

      {(signingState === 'authenticating' || signingState === 'signing') && (
        <View style={text.line}>
          <ActivityIndicator size="small" color={theme.colors.interactive.default} />
          <Text style={[text.heading, text.lineText]}>
            {signingState === 'authenticating' ? 'Authenticating...' : 'Signing Transaction...'}
          </Text>
        </View>
      )}

      {signingState === 'success' && (
        <View style={text.line}>
          <CheckCircleIcon size={size} color={theme.colors.status.success.icon} weight="fill" />
          <Text style={[text.heading, styles.successTitle, text.lineText]}>Transaction Signed</Text>
        </View>
      )}

      {signingState === 'error' && (
        <View style={text.line}>
          <WarningCircleIcon size={size} color={theme.colors.status.error.icon} weight="fill" />
          <View style={[text.group, text.lineText]}>
            <Text accessibilityRole="header" style={[text.heading, styles.errorTitle]}>
              Signing Failed
            </Text>
            {error && <Text style={text.error}>{error}</Text>}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
