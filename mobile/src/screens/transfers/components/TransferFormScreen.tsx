import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GradientBackground } from '../../../components/GradientBackground';
import { Panel } from '../../../components/panel';
import { Action } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import { QRScanner } from '../../../components/qr';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { getChainShortCode, isBitcoinChain, normalizeBitcoinRawTransactionHex } from '@ledova/shared';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { SendForm } from './SendForm';
import { ReviewTransaction } from './ReviewTransaction';
import { BitcoinSignTransaction } from './BitcoinSignTransaction';
import { SuccessModal } from './SuccessModal';
import { RefusalNotice } from './RefusalNotice';
import { useTransfers } from '../useTransfers';

type Props = NativeStackScreenProps<WalletsStackParamList, 'TransferDetails'>;

export function TransferFormScreen({ route, navigation }: Props) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
  }));
  const { wallet: routeWallet, chosen = false } = route.params;
  const [showAddressScanner, setShowAddressScanner] = useState(false);
  const [signedHexInput, setSignedHexInput] = useState('');
  const [signedHexError, setSignedHexError] = useState<string | null>(null);
  const chainShortName = getChainShortCode(routeWallet.chain);
  const isBitcoin = isBitcoinChain(chainShortName);

  const {
    step,
    wallet,
    selectedAsset,
    transferableAssets,
    toAddress,
    amount,
    transactionData,
    txHash,
    isLoadingHoldings,
    holdingsError,
    isRetryingHoldings,
    retryHoldings,
    isPreparing,
    prepareError,
    broadcastError,
    selectWallet,
    selectAsset,
    setToAddress,
    setAmount,
    useMaxAmount,
    submitTransfer,
    proceedToSign,
    handleSignature,
    backToReview,
    reset,
  } = useTransfers();

  useEffect(() => {
    if (isBitcoin) selectWallet(routeWallet);
  }, [isBitcoin, routeWallet, selectWallet]);

  const canSubmit = !!toAddress && !!amount && !!selectedAsset && !isPreparing && !holdingsError;

  const handleOpenAddressScanner = useCallback(() => {
    setShowAddressScanner(true);
  }, []);

  const handleCloseAddressScanner = useCallback(() => {
    setShowAddressScanner(false);
  }, []);

  const handleAddressScan = useCallback(
    (data: string) => {
      setToAddress(data);
      setShowAddressScanner(false);
    },
    [setToAddress],
  );

  const handleSignedHexChange = useCallback((value: string) => {
    setSignedHexInput(value);
    setSignedHexError(null);
  }, []);

  const handleBroadcastSignedHex = useCallback(() => {
    const normalized = normalizeBitcoinRawTransactionHex(signedHexInput);
    if (!normalized) {
      setSignedHexError('Enter the signed raw transaction as hex (whole bytes; an optional 0x prefix is removed).');
      return;
    }
    setSignedHexError(null);
    handleSignature(normalized);
  }, [signedHexInput, handleSignature]);

  const handleBack = useCallback(() => {
    reset();
    selectWallet(routeWallet);
  }, [reset, routeWallet, selectWallet]);

  const handleDone = useCallback(() => {
    reset();
    navigation.goBack();
  }, [reset, navigation]);

  const renderContent = () => {
    if (!isBitcoin) {
      return <Text style={text.error}>This form sends Bitcoin only.</Text>;
    }

    if (!wallet || step === 'select-wallet') {
      return (
        <View style={styles.status}>
          <ActivityIndicator size="small" color={theme.colors.interactive.active} />
          <Text style={text.muted}>Loading wallet...</Text>
        </View>
      );
    }

    switch (step) {
      case 'enter-details':
        return (
          <SendForm
            chainShortName={chainShortName}
            walletName={wallet.name || ''}
            walletAddress={wallet.address}
            selectedAsset={selectedAsset}
            transferableAssets={transferableAssets}
            toAddress={toAddress}
            amount={amount}
            isLoadingHoldings={isLoadingHoldings}
            holdingsError={holdingsError}
            isRetryingHoldings={isRetryingHoldings}
            retryHoldings={retryHoldings}
            selectAsset={selectAsset}
            setToAddress={setToAddress}
            setAmount={setAmount}
            useMaxAmount={useMaxAmount}
            onOpenAddressScanner={handleOpenAddressScanner}
          />
        );

      case 'review':
        if (!transactionData) return null;
        return <ReviewTransaction transactionData={transactionData} chainShortName={chainShortName} />;

      case 'sign':
        if (!transactionData) return null;
        return (
          <BitcoinSignTransaction
            transactionData={transactionData}
            signedHex={signedHexInput}
            onChangeSignedHex={handleSignedHexChange}
            error={signedHexError}
          />
        );

      case 'broadcast':
        return (
          <View style={text.group}>
            <View style={styles.status}>
              {!broadcastError && <ActivityIndicator size="small" color={theme.colors.interactive.active} />}
              <Text accessibilityRole="header" style={text.heading}>
                Broadcasting Transaction
              </Text>
            </View>
            {!broadcastError && <Text style={text.muted}>Submitting your transaction to the network...</Text>}
            {broadcastError && <Text style={text.error}>{broadcastError}</Text>}
          </View>
        );

      case 'success':
        return (
          <SuccessModal visible={true} txHash={txHash || null} chainShortName={chainShortName} onDone={handleDone} />
        );

      default:
        return null;
    }
  };

  const renderActions = () => {
    if (!isBitcoin) return <Action label={chosen ? 'Back' : 'Cancel'} onPress={() => navigation.goBack()} />;
    if (step === 'success' || step === 'select-wallet') return null;
    if (!wallet) return null;

    if (step === 'broadcast') {
      if (!broadcastError) return null;
      return <Action label="Back" onPress={backToReview} />;
    }

    if (step === 'enter-details') {
      return (
        <>
          <Action label={chosen ? 'Back' : 'Cancel'} onPress={() => navigation.goBack()} />
          <Action
            label={isPreparing ? 'Loading...' : 'Continue'}
            primary
            disabled={!canSubmit}
            onPress={submitTransfer}
          />
        </>
      );
    }

    if (step === 'review') {
      return (
        <>
          <Action label="Back" onPress={handleBack} />
          <Action label="Sign" primary onPress={proceedToSign} />
        </>
      );
    }

    if (step === 'sign') {
      return (
        <>
          <Action label="Back" onPress={backToReview} />
          <Action
            label="Broadcast"
            primary
            disabled={signedHexInput.trim().length === 0}
            onPress={handleBroadcastSignedHex}
          />
        </>
      );
    }

    return null;
  };

  return (
    <GradientBackground>
      <View style={styles.container}>
        <Panel
          title="Send"
          notice={prepareError ? <RefusalNotice message={prepareError} /> : null}
          actions={renderActions()}
        >
          {renderContent()}
        </Panel>
      </View>

      <QRScanner
        visible={showAddressScanner}
        onClose={handleCloseAddressScanner}
        onScan={handleAddressScan}
        title="Scan Destination Address"
        subtitle="Scan the QR code of the destination wallet address"
      />
    </GradientBackground>
  );
}
