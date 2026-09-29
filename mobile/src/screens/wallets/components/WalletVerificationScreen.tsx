import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, ScrollView } from 'react-native';
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
} from '@ledova/shared';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { useWalletVerification } from '../useWalletVerification';
import { VerificationInstructions } from './VerificationInstructions';
import { ChallengeQRStep } from './ChallengeQRStep';
import { SignatureScanStep } from './SignatureScanStep';

type WalletVerificationRouteProp = RouteProp<WalletsStackParamList, 'WalletVerification'>;

export function WalletVerificationScreen() {
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
  const route = useRoute<WalletVerificationRouteProp>();
  const isFocused = useIsFocused();
  const [scanError, setScanError] = useState<string | null>(null);

  const { wallet } = route.params;

  const isSoftwareWallet = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.SOFTWARE;

  const {
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
  } = useWalletVerification({ wallet });

  const hasAutoVerified = useRef(false);
  useEffect(() => {
    if (isSoftwareWallet && !hasAutoVerified.current) {
      hasAutoVerified.current = true;
      autoVerify();
    }
  }, [isSoftwareWallet]);

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
        navigation.goBack();
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
            disabled={busy}
            onPress={verificationError ? autoVerify : () => navigation.goBack()}
          />
        );
      }

      return (
        <Action
          label={isRequestingChallenge ? 'Loading...' : 'Start'}
          primary
          disabled={isRequestingChallenge}
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
