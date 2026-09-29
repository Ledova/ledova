import { useEffect, useCallback, useState } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { getWalletVerificationEvmChainId } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import type { Wallet } from '@ledova/shared';
import { Modal, ModalActions } from '@components/Modal';
import { PageAction } from '@components/Page';
import { SeedPhraseInput } from '@components/SeedPhraseInput';
import { useQRScanner, QRScannerView } from '@components/qr';
import { useWalletVerification } from '../hooks/useWalletVerification';
import { decodeKeystoneMessageSignature } from '@utils/keystone/urDecoder';

interface WalletVerificationModalProps {
  isOpen: boolean;
  wallet: Wallet | null;
  onClose: () => void;
}

export function WalletVerificationModal({ isOpen, wallet, onClose }: WalletVerificationModalProps) {
  const {
    verificationStep,
    challengeQrData,
    verificationError,
    verificationSuccess,
    isRequestingChallenge,
    isVerifying,
    isSigningWithSeedPhrase,
    startVerification,
    proceedToScanSignature,
    handleSignatureScanned,
    signWithSeedPhrase,
    goBack,
    reset,
  } = useWalletVerification();

  const [seedPhrase, setSeedPhrase] = useState('');

  const { error: scannerError, stopScanner } = useQRScanner({
    scannerId: 'qr-scanner',
    onScanSuccess: (text) => {
      const signature = decodeKeystoneMessageSignature(text);
      if (signature) {
        handleSignatureScanned(signature);
      }
    },
    enabled: verificationStep === 'scan-signature',
  });

  const handleClose = useCallback(() => {
    stopScanner();
    setSeedPhrase('');
    reset();
    onClose();
  }, [onClose, reset, stopScanner]);

  useEffect(() => {
    if (verificationSuccess) {
      const timer = setTimeout(() => {
        handleClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [verificationSuccess, handleClose]);

  const handleStartVerification = () => {
    if (wallet) {
      startVerification(wallet, 'hardware');
    }
  };

  const handleStartSeedPhraseVerification = () => {
    if (wallet) {
      setSeedPhrase('');
      startVerification(wallet, 'software');
    }
  };

  const handleBackFromSeedPhrase = () => {
    setSeedPhrase('');
    goBack();
  };

  const handleSignWithSeedPhrase = () => {
    const phrase = seedPhrase;
    setSeedPhrase('');
    void signWithSeedPhrase(phrase);
  };

  if (!wallet) return null;

  const supportsSeedPhraseSigning = getWalletVerificationEvmChainId(wallet.chain) !== null;

  const renderStepContent = () => {
    switch (verificationStep) {
      case 'instructions':
        return (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              Prove ownership of this wallet by signing a verification message with your hardware wallet.
            </p>

            <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
              <li>Scan the challenge QR code with your hardware wallet</li>
              <li>Sign the message on your hardware wallet</li>
              <li>Scan the signature QR code from your hardware wallet</li>
            </ol>

            {verificationError && <p className="text-sm text-error-light">{verificationError}</p>}

            <ModalActions>
              {supportsSeedPhraseSigning && (
                <PageAction
                  label="Sign with a seed phrase"
                  onClick={handleStartSeedPhraseVerification}
                  disabled={isRequestingChallenge}
                />
              )}
              <PageAction
                label={isRequestingChallenge ? 'Generating Challenge...' : 'Continue'}
                primary
                onClick={handleStartVerification}
                disabled={isRequestingChallenge}
              />
            </ModalActions>
          </div>
        );

      case 'show-challenge-qr':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-text-primary">Scan Challenge</h3>
              <p className="text-sm text-text-muted">Scan this QR code with your hardware wallet</p>
            </div>

            {challengeQrData && (
              <div className="flex justify-center py-2">
                <QRCodeSVG value={challengeQrData} size={220} level="M" />
              </div>
            )}

            {verificationError && <p className="text-sm text-error-light">{verificationError}</p>}

            <ModalActions>
              <PageAction label="Back" onClick={goBack} />
              <PageAction label="I've Signed the Message" primary onClick={proceedToScanSignature} />
            </ModalActions>
          </div>
        );

      case 'scan-signature':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-text-primary">Scan Signature</h3>
              <p className="text-sm text-text-muted">
                Point your camera at the signature QR code on your hardware wallet
              </p>
            </div>

            <QRScannerView scannerId="qr-scanner" error={scannerError} />

            {verificationError && <p className="text-sm text-error-light">{verificationError}</p>}

            {isVerifying && (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-mid"></div>
                <span className="text-sm text-text-muted">Verifying signature...</span>
              </div>
            )}

            <ModalActions>
              <PageAction label="Back" onClick={goBack} />
            </ModalActions>
          </div>
        );

      case 'sign-software':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-text-primary">Sign with Seed Phrase</h3>
              <p className="text-sm text-text-muted">
                Enter the seed phrase for wallet{' '}
                <span className="font-mono text-xs text-text-secondary">
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </span>
              </p>
            </div>

            <SeedPhraseInput
              value={seedPhrase}
              onChange={setSeedPhrase}
              disabled={isSigningWithSeedPhrase || isVerifying}
            />

            {verificationError && (
              <div className="space-y-1">
                <p className="text-sm text-error-light">{verificationError}</p>
                {!seedPhrase && (
                  <p className="text-xs text-error-light/80">
                    The phrase was cleared when it was handed to the signer. Enter it again to retry.
                  </p>
                )}
              </div>
            )}

            <ModalActions>
              <PageAction label="Back" onClick={handleBackFromSeedPhrase} />
              <PageAction
                label={isSigningWithSeedPhrase || isVerifying ? 'Verifying...' : 'Sign and Verify'}
                primary
                onClick={handleSignWithSeedPhrase}
                disabled={!seedPhrase.trim() || isSigningWithSeedPhrase || isVerifying}
              />
            </ModalActions>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium text-success-light">
              <CheckCircleIcon size={ICON_MD} weight="fill" />
              Wallet Verified!
            </h3>
            <p className="text-sm text-text-muted">Your wallet has been successfully verified.</p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Verify Wallet">
      {renderStepContent()}
    </Modal>
  );
}
