import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Wallet } from '@ledova/shared';
import type { BottomTabParamList } from '../../../navigation/BottomTabNavigator';
import type { SendStackParamList } from '../../../navigation/SendStackNavigator';
import { GradientBackground } from '../../../components/GradientBackground';
import { Panel } from '../../../components/panel';
import { Action } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import { QRScanner } from '../../../components/qr';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { getChainShortCode, isBitcoinChain, isSupportedEvmChain, WALLET_SIGNING_PREFERENCE } from '@ledova/shared';
import { SendForm } from '../../transfers/components/SendForm';
import { ReviewTransaction } from '../../transfers/components/ReviewTransaction';
import { SignTransaction } from '../../transfers/components/SignTransaction';
import { SoftwareSignTransaction } from '../../transfers/components/SoftwareSignTransaction';
import { SuccessModal } from '../../transfers/components/SuccessModal';
import { WalletSelectionStep } from './WalletSelectionStep';
import { encodeEthereumTransaction } from '../../../utils/keystone/urEncoder';
import { decodeKeystoneSignature } from '../../../utils/keystone/urDecoder';
import { reviewTransfer } from '../../../utils/preparedTransfer';
import { useTransfers } from '../../transfers/useTransfers';

interface SendFormScreenProps {
  onDone: () => void;
  wallet?: Wallet;
}

type SendNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<SendStackParamList>,
  BottomTabNavigationProp<BottomTabParamList>
>;

export function SendFormScreen({ onDone, wallet: onlyWallet }: SendFormScreenProps) {
  const theme = useAppTheme();
  const navigation = useNavigation<SendNavigation>();
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
  const [showAddressScanner, setShowAddressScanner] = useState(false);
  const [showSignatureScanner, setShowSignatureScanner] = useState(false);
  const [softwareSignTrigger, setSoftwareSignTrigger] = useState(0);

  const {
    step,
    wallet,
    wallets,
    isLoading,
    walletsFailed,
    isRetryingWallets,
    retryWallets,
    selectedAsset,
    transferableAssets,
    toAddress,
    amount,
    transactionData,
    preparedAsset,
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
  } = useTransfers(onlyWallet ?? null);

  const isSoftwareWallet = wallet?.signingPreference === WALLET_SIGNING_PREFERENCE.SOFTWARE;
  const chainShortName = wallet ? getChainShortCode(wallet.chain) : 'ETH';
  const isEvm = isSupportedEvmChain(chainShortName);

  const handleSelectWallet = useCallback(
    (selected: Wallet) => {
      if (isBitcoinChain(getChainShortCode(selected.chain))) {
        navigation.navigate('Wallets', {
          screen: 'TransferDetails',
          initial: false,
          params: { wallet: selected, chosen: true },
        });
        return;
      }
      selectWallet(selected);
    },
    [navigation, selectWallet],
  );
  const canSubmit = !!toAddress && !!amount && !!selectedAsset && !isPreparing;

  const review = useMemo(
    () => (transactionData && isEvm ? reviewTransfer(transactionData, preparedAsset ?? undefined) : null),
    [transactionData, isEvm, preparedAsset],
  );
  const [refusedScan, setRefusedScan] = useState<{ review: typeof review; message: string } | null>(null);

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
    setRefusedScan(null);
    setShowSignatureScanner(true);
  }, []);

  const handleCloseSignatureScanner = useCallback(() => {
    setShowSignatureScanner(false);
  }, []);

  const handleSignatureScan = useCallback(
    (data: string) => {
      if (!review?.transaction || !wallet) return;

      setShowSignatureScanner(false);
      try {
        handleSignature(decodeKeystoneSignature(data, review.transaction, wallet.address));
      } catch (error) {
        setRefusedScan({ review, message: error instanceof Error ? error.message : 'The scanned code was refused.' });
      }
    },
    [handleSignature, review, wallet],
  );

  const handleBack = useCallback(() => {
    if (step === 'enter-details') {
      reset();
    } else if (step === 'review') {
      reset();
      if (wallet) selectWallet(wallet);
    } else if (step === 'sign') {
      backToReview();
    }
  }, [step, reset, wallet, selectWallet, backToReview]);

  const handleDone = useCallback(() => {
    reset();
    onDone();
  }, [reset, onDone]);

  const renderContent = () => {
    if (step === 'select-wallet') {
      return (
        <WalletSelectionStep
          wallets={wallets}
          isLoading={isLoading}
          failed={walletsFailed}
          retrying={isRetryingWallets}
          onRetry={retryWallets}
          onSelectWallet={handleSelectWallet}
        />
      );
    }

    if (!wallet) {
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
            selectAsset={selectAsset}
            setToAddress={setToAddress}
            setAmount={setAmount}
            useMaxAmount={useMaxAmount}
            onOpenAddressScanner={handleOpenAddressScanner}
          />
        );

      case 'review':
        if (!transactionData) return null;
        return (
          <ReviewTransaction
            transactionData={transactionData}
            chainShortName={chainShortName}
            tokenSymbol={preparedAsset?.symbol}
          />
        );

      case 'sign':
        if (wallet.signingPreference === WALLET_SIGNING_PREFERENCE.SOFTWARE) {
          if (!transactionData) return null;
          return (
            <SoftwareSignTransaction
              wallet={wallet}
              transactionData={transactionData}
              asset={preparedAsset ?? undefined}
              onSignComplete={handleSignature}
              signTrigger={softwareSignTrigger}
            />
          );
        }
        return (
          <SignTransaction
            urEncodedTransaction={urEncodedTransaction}
            error={review?.error ?? (refusedScan?.review === review ? refusedScan.message : null)}
          />
        );

      case 'broadcast':
        return (
          <View style={text.group}>
            <View style={styles.status}>
              <ActivityIndicator size="small" color={theme.colors.interactive.active} />
              <Text accessibilityRole="header" style={text.heading}>
                Broadcasting Transaction
              </Text>
            </View>
            <Text style={text.muted}>Submitting your transaction to the network...</Text>
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
    if (step === 'broadcast' || step === 'success') return null;

    if (step === 'select-wallet') {
      return <Action label="Cancel" onPress={handleDone} />;
    }

    if (!wallet) return null;

    if (step === 'enter-details') {
      return (
        <>
          {onlyWallet ? <Action label="Cancel" onPress={onDone} /> : <Action label="Back" onPress={handleBack} />}
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
          {isSoftwareWallet ? (
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
        <Panel
          title={step === 'select-wallet' ? 'Select your wallet' : 'Send'}
          notice={
            prepareError ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={text.error}>
                {prepareError}
              </Text>
            ) : null
          }
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

      {!isSoftwareWallet && (
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
