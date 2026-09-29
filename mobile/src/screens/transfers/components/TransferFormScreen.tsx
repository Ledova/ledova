import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GradientBackground } from '../../../components/GradientBackground';
import { Panel } from '../../../components/panel';
import { Action } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import { QRScanner } from '../../../components/qr';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import {
  getChainShortCode,
  isBitcoinChain,
  isSupportedEvmChain,
  normalizeBitcoinRawTransactionHex,
  WALLET_SIGNING_PREFERENCE,
} from '@ledova/shared';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { SendForm } from './SendForm';
import { ReviewTransaction } from './ReviewTransaction';
import { SignTransaction } from './SignTransaction';
import { SoftwareSignTransaction } from './SoftwareSignTransaction';
import { BitcoinSignTransaction } from './BitcoinSignTransaction';
import { SuccessModal } from './SuccessModal';
import { encodeEthereumTransaction } from '../../../utils/keystone/urEncoder';
import { decodeKeystoneSignature } from '../../../utils/keystone/urDecoder';
import { reviewTransfer } from '../../../utils/preparedTransfer';
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
  const { wallet: routeWallet } = route.params;
  const [showAddressScanner, setShowAddressScanner] = useState(false);
  const [showSignatureScanner, setShowSignatureScanner] = useState(false);
  const [softwareSignTrigger, setSoftwareSignTrigger] = useState(0);
  const [signedHexInput, setSignedHexInput] = useState('');
  const [signedHexError, setSignedHexError] = useState<string | null>(null);
  const isSoftwareWallet = routeWallet?.signingPreference === WALLET_SIGNING_PREFERENCE.SOFTWARE;

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
    if (routeWallet) {
      selectWallet(routeWallet);
    }
  }, [routeWallet, selectWallet]);

  const chainShortName = wallet ? getChainShortCode(wallet.chain) : 'ETH';
  const isEvm = isSupportedEvmChain(chainShortName);
  const isBitcoin = isBitcoinChain(chainShortName);
  const canSubmit = !!toAddress && !!amount && !!selectedAsset && !isPreparing;

  const review = useMemo(
    () => (transactionData && isEvm ? reviewTransfer(transactionData, selectedAsset?.decimals) : null),
    [transactionData, isEvm, selectedAsset],
  );

  const urEncodedTransaction = useMemo(() => {
    if (!review?.transaction || !wallet) return null;

    try {
      const encoded = encodeEthereumTransaction(
        wallet.address,
        review.transaction,
        wallet.derivationPath ?? undefined,
        wallet.masterFingerprint ?? undefined,
      );
      return encoded?.urString || null;
    } catch {
      return null;
    }
  }, [review, wallet]);

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

  const handleOpenSignatureScanner = useCallback(() => {
    setShowSignatureScanner(true);
  }, []);

  const handleCloseSignatureScanner = useCallback(() => {
    setShowSignatureScanner(false);
  }, []);

  const handleSignatureScan = useCallback(
    (data: string) => {
      if (!review?.transaction) return;

      const signedTx = decodeKeystoneSignature(data, review.transaction);
      if (signedTx) {
        handleSignature(signedTx);
        setShowSignatureScanner(false);
      }
    },
    [handleSignature, review],
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
    if (step === 'review') {
      reset();
      if (routeWallet) selectWallet(routeWallet);
    } else if (step === 'sign') {
      backToReview();
    } else {
      navigation.goBack();
    }
  }, [step, reset, routeWallet, selectWallet, backToReview, navigation]);

  const handleDone = useCallback(() => {
    reset();
    navigation.goBack();
  }, [reset, navigation]);

  const renderContent = () => {
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
            prepareError={prepareError}
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
        if (isBitcoin) {
          if (!transactionData) return null;
          return (
            <BitcoinSignTransaction
              transactionData={transactionData}
              signedHex={signedHexInput}
              onChangeSignedHex={handleSignedHexChange}
              error={signedHexError}
            />
          );
        }
        if (wallet.signingPreference === WALLET_SIGNING_PREFERENCE.SOFTWARE) {
          if (!transactionData) return null;
          return (
            <SoftwareSignTransaction
              wallet={wallet}
              transactionData={transactionData}
              tokenDecimals={selectedAsset?.decimals}
              onSignComplete={handleSignature}
              signTrigger={softwareSignTrigger}
            />
          );
        }
        return <SignTransaction urEncodedTransaction={urEncodedTransaction} error={review?.error ?? null} />;

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
    if (step === 'success' || step === 'select-wallet') return null;
    if (!wallet) return null;

    if (step === 'broadcast') {
      if (!broadcastError) return null;
      return <Action label="Back" onPress={backToReview} />;
    }

    if (step === 'enter-details') {
      return (
        <Action
          label={isPreparing ? 'Loading...' : 'Continue'}
          primary
          disabled={!canSubmit}
          onPress={submitTransfer}
        />
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
          {isBitcoin ? (
            <Action
              label="Broadcast"
              primary
              disabled={signedHexInput.trim().length === 0}
              onPress={handleBroadcastSignedHex}
            />
          ) : isSoftwareWallet ? (
            <Action label="Sign & Send" primary onPress={() => setSoftwareSignTrigger((prev) => prev + 1)} />
          ) : (
            <Action label="Scan Signature" primary onPress={handleOpenSignatureScanner} />
          )}
        </>
      );
    }

    return null;
  };

  return (
    <GradientBackground>
      <View style={styles.container}>
        <Panel title="Send" actions={renderActions()}>
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

      {!isSoftwareWallet && !isBitcoin && (
        <QRScanner
          visible={showSignatureScanner}
          onClose={handleCloseSignatureScanner}
          onScan={handleSignatureScan}
          title="Scan Signed Transaction"
          subtitle="Scan the signature QR code from your hardware wallet"
        />
      )}
    </GradientBackground>
  );
}
