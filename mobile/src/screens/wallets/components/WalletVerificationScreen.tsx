import React, { useEffect, useMemo, useState, useRef, useSyncExternalStore } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { Action } from '../../../components/Ledger';
import { useNavigation, useRoute, useIsFocused, RouteProp } from '@react-navigation/native';
import { useCameraScanner } from '../../../components/qr/useCameraScanner';
import { GradientBackground } from '../../../components/GradientBackground';
import { Panel } from '../../../components/panel';
import { encodeEthereumMessage, encodeBitcoinMessage } from '../../../utils/keystone/urEncoder';
import { decodeKeystoneMessageSignature } from '../../../utils/keystone/urDecoder';
import { useThemedStyles } from '../../../contexts';
import {
  getChainShortCode,
  BLOCKCHAIN,
  isBitcoinChain,
  getWalletVerificationEvmChainId,
  WALLET_SIGNING_PREFERENCE,
  useSubmissionOwner,
  type Wallet,
} from '@ledova/shared';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { useWalletVerification } from '../useWalletVerification';
import { VerificationInstructions } from './VerificationInstructions';
import { ChallengeQRStep } from './ChallengeQRStep';
import { SignatureScanStep } from './SignatureScanStep';
import { orderSubmissionSession } from '../../../services/orderSubmissions';
import { getSessionEpoch, subscribeSession } from '../../../services/sessionScope';

type WalletVerificationRouteProp = RouteProp<WalletsStackParamList, 'WalletVerification'>;

export function WalletVerificationScreen() {
  const route = useRoute<WalletVerificationRouteProp>();
  const { owner } = useSubmissionOwner(orderSubmissionSession);
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  const wallet = route.params.wallet;
  const nomination = route.params.nomination;
  const walletKey = JSON.stringify([
    wallet.uuid,
    wallet.userAccount,
    wallet.address,
    wallet.chain,
    wallet.signingPreference,
    wallet.derivationPath,
    wallet.masterFingerprint,
    nomination?.request,
    nomination?.company,
  ]);
  const [scope, setScope] = useState({ owner, epoch, walletKey, generation: 0 });
  if (scope.owner !== owner || scope.epoch !== epoch || scope.walletKey !== walletKey) {
    setScope({ owner, epoch, walletKey, generation: scope.generation + 1 });
    return null;
  }
  if (!owner || wallet.userAccount !== owner.ownerAccountUuid)
    return <Text>Your signed-in account must be checked before verifying this own wallet.</Text>;
  return <WalletVerification key={scope.generation} wallet={wallet} nomination={nomination} />;
}

function WalletVerification({
  wallet,
  nomination,
}: {
  wallet: Wallet;
  nomination?: WalletsStackParamList['WalletVerification']['nomination'];
}) {
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
    },
    scrollView: {
      flex: 1,
    },
  }));
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const [scanError, setScanError] = useState<string | null>(null);

  const isSoftwareWallet = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.SOFTWARE;

  const {
    ready,
    refresh,
    guard,
    verificationChallenge,
    verificationStep,
    isRequestingChallenge,
    isVerifying,
    verificationError,
    verificationSuccess,
    requestChallenge,
    proceedToScanSignature,
    goBackVerificationStep,
    verifySignature,
    autoVerify,
    reset,
  } = useWalletVerification({ wallet, nomination });

  const hasAutoVerified = useRef(false);
  useEffect(() => {
    if (isSoftwareWallet && ready && !hasAutoVerified.current) {
      hasAutoVerified.current = true;
      autoVerify();
    }
  }, [isSoftwareWallet, ready]);

  useEffect(() => {
    setScanError(null);
  }, [verificationStep]);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  useEffect(() => {
    if (verificationSuccess) {
      const timer = setTimeout(() => {
        try {
          guard();
          if (nomination) {
            if (navigation.canGoBack()) navigation.goBack();
            navigation.getParent()?.navigate('Home', { screen: 'ParticipantEligibility' });
          } else navigation.goBack();
        } catch {}
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [verificationSuccess, navigation]);

  const chainShortName = getChainShortCode(wallet?.chain || BLOCKCHAIN.ETHEREUM);
  const isBitcoin = isBitcoinChain(chainShortName);
  const evmChainId = wallet ? getWalletVerificationEvmChainId(wallet.chain) : null;

  const urEncodedChallenge = useMemo(() => {
    if (!verificationChallenge || !wallet) return null;
    if (!wallet.derivationPath || !wallet.masterFingerprint) return null;

    try {
      let encoded: { type: string; cbor: Buffer; urString: string } | null = null;

      if (evmChainId !== null) {
        encoded = encodeEthereumMessage(
          wallet.address,
          verificationChallenge,
          wallet.derivationPath,
          wallet.masterFingerprint,
          evmChainId,
        );
      } else if (isBitcoin) {
        encoded = encodeBitcoinMessage(
          wallet.address,
          verificationChallenge,
          wallet.derivationPath,
          wallet.masterFingerprint,
        );
      } else {
        return null;
      }

      return encoded?.urString || null;
    } catch {
      return null;
    }
  }, [verificationChallenge, wallet, evmChainId, isBitcoin]);

  const camera = useCameraScanner(
    isFocused && !isSoftwareWallet && verificationStep === 'scan-signature',
    (data, finishScan) => {
      if (isVerifying || verificationSuccess) return;
      const decodedSignature = decodeKeystoneMessageSignature(data);
      if (!decodedSignature) {
        setScanError('This QR code is not a supported signature. Scan the signature shown by your wallet.');
        return;
      }
      setScanError(null);
      finishScan();
      verifySignature(decodedSignature);
    },
    wallet.uuid,
  );

  const renderActions = () => {
    if (verificationStep === 'instructions') {
      if (isSoftwareWallet) {
        const busy = isRequestingChallenge || isVerifying;
        return (
          <Action
            label={busy ? 'Loading...' : verificationError ? 'Retry' : 'Cancel'}
            primary={Boolean(verificationError)}
            disabled={busy || !ready}
            onPress={verificationError ? autoVerify : () => navigation.goBack()}
          />
        );
      }

      return (
        <Action
          label={isRequestingChallenge ? 'Loading...' : 'Start'}
          primary
          disabled={isRequestingChallenge || !ready}
          onPress={requestChallenge}
        />
      );
    }

    if (verificationStep === 'show-challenge-qr') {
      return <Action label="Continue" primary onPress={proceedToScanSignature} />;
    }

    if (verificationStep === 'scan-signature') {
      return (
        <Action
          label="Back"
          onPress={() => {
            camera.stop();
            goBackVerificationStep();
          }}
        />
      );
    }

    return null;
  };

  if (!wallet) {
    navigation.goBack();
    return null;
  }

  return (
    <GradientBackground>
      <View style={styles.container}>
        <Panel title="Verify Wallet" actions={renderActions()}>
          {!ready && <Action label="Refresh own wallet" onPress={() => void refresh()} />}
          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {verificationStep === 'instructions' && (
              <VerificationInstructions
                isSoftwareWallet={isSoftwareWallet}
                isRequestingChallenge={isRequestingChallenge}
                isVerifying={isVerifying}
                verificationSuccess={verificationSuccess}
                verificationError={verificationError}
              />
            )}
            {verificationStep === 'show-challenge-qr' && <ChallengeQRStep urEncodedChallenge={urEncodedChallenge} />}
            {verificationStep === 'scan-signature' && (
              <SignatureScanStep
                cameraMessage={camera.message}
                isVerifying={isVerifying}
                verificationSuccess={verificationSuccess}
                verificationError={scanError || verificationError}
                preview={camera.preview}
              />
            )}
          </ScrollView>
        </Panel>
      </View>
    </GradientBackground>
  );
}
