import { useEffect, useRef, useCallback, useState } from 'react';
import { CheckCircleIcon, WarningCircleIcon, SpinnerGapIcon, ArrowSquareOutIcon } from '@phosphor-icons/react';
import { AnimatedQRCode } from '@keystonehq/animated-qr';
import {
  formatWalletAddressMedium,
  BLOCKCHAIN,
  DESIGN_TOKENS,
  getBlockExplorerTxUrl,
  getNativeAssetSymbol,
} from '@ledova/shared';
import { useQRScanner, QRScannerView } from '@components/qr';
import { Row, Rows } from '@components/Ledger';
import { Modal, ModalActions } from '@components/Modal';
import { PageAction } from '@components/Page';

const ICON_XS = DESIGN_TOKENS.icon.sizes.xs;
const ICON_MD = DESIGN_TOKENS.icon.sizes.md;
const ICON_XL = DESIGN_TOKENS.icon.sizes.xl;
import type {
  Wallet,
  WalletTokenBalance,
  ShareTokenTransferPrepareResponse,
  PreparedWalletTransfer,
} from '@ledova/shared';
import { encodeEthereumTransaction } from '@utils/keystone/urEncoder';
import { decodeKeystoneSignedTransaction } from '@utils/keystone/urDecoder';
import { BitcoinSignStep } from './BitcoinSignStep';

export type TransferType = 'crypto' | 'stablecoin' | 'share_token';

type SigningStep =
  'loading' | 'instructions' | 'show-qr' | 'scan-signature' | 'sign-manual' | 'submitting' | 'success' | 'error';

interface TransferSigningFlowProps {
  isOpen: boolean;
  onClose: () => void;
  transferType: TransferType;
  wallet: Wallet;
  toAddress?: string;
  amount?: string;
  token?: Pick<WalletTokenBalance, 'name' | 'symbol'>;
  preparedTransaction?: ShareTokenTransferPrepareResponse | PreparedWalletTransfer | null;
  isPreparing?: boolean;
  prepareError?: string | null;
  onPrepare?: () => void;
  onBroadcast?: (signedTx: string) => Promise<string>;
  onSuccess?: (txHash: string) => void;
}

interface TransactionForQr {
  to: string;
  from: string;
  data: string;
  value: string;
  gas: string;
  gasPrice: string;
  nonce: string;
  chainId: string;
}

function formatTransactionForQr(
  preparedTx: ShareTokenTransferPrepareResponse | PreparedWalletTransfer,
  wallet: Wallet,
): TransactionForQr | null {
  if ('transactionData' in preparedTx && preparedTx.transactionData) {
    const tx = preparedTx.transactionData;
    return {
      to: tx.to,
      from: wallet.address,
      data: tx.data,
      value: '0x' + tx.value.toString(16),
      gas: '0x' + tx.gas.toString(16),
      gasPrice: '0x' + tx.gasPrice.toString(16),
      nonce: '0x' + tx.nonce.toString(16),
      chainId: '0x' + tx.chainId.toString(16),
    };
  }

  if ('transaction' in preparedTx && preparedTx.transaction) {
    const tx = preparedTx.transaction;
    return {
      to: tx.to,
      from: wallet.address,
      data: tx.data || '0x',
      value: '0x' + tx.value.toString(16),
      gas: '0x' + tx.gas.toString(16),
      gasPrice: '0x' + tx.gasPrice.toString(16),
      nonce: '0x' + tx.nonce.toString(16),
      chainId: '0x' + tx.chainId.toString(16),
    };
  }

  return null;
}

export function TransferSigningFlow({
  isOpen,
  onClose,
  transferType,
  wallet,
  toAddress,
  amount,
  token,
  preparedTransaction,
  isPreparing = false,
  prepareError = null,
  onPrepare,
  onBroadcast,
  onSuccess,
}: TransferSigningFlowProps) {
  const [recordedStep, setSigningStep] = useState<SigningStep>('loading');
  const [qrData, setQrData] = useState<{ cborHex: string; type: string } | null>(null);
  const [recordedError, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [unsignedTx, setUnsignedTx] = useState<TransactionForQr | null>(null);
  const [signedTransaction, setSignedTransaction] = useState('');
  const [wasOpen, setWasOpen] = useState(isOpen);

  const isBitcoin = wallet.chain === BLOCKCHAIN.BITCOIN;
  const nativeSymbol = getNativeAssetSymbol(wallet.chain);

  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSigningStep('loading');
      setQrData(null);
      setError(null);
      setTxHash(null);
      setUnsignedTx(null);
      setSignedTransaction('');
    }
  }

  const awaitingPreparation = isOpen && recordedStep === 'loading';
  const signingStep: SigningStep =
    awaitingPreparation && prepareError
      ? 'error'
      : awaitingPreparation && preparedTransaction
        ? isBitcoin
          ? 'sign-manual'
          : 'instructions'
        : recordedStep;
  const error = awaitingPreparation && prepareError ? prepareError : recordedError;

  const hasPreparedRef = useRef(false);
  const onPrepareRef = useRef(onPrepare);

  useEffect(() => {
    onPrepareRef.current = onPrepare;
  }, [onPrepare]);

  const getTitle = () => {
    switch (transferType) {
      case 'crypto':
        return 'Sign Transfer';
      case 'stablecoin':
        return 'Sign Stablecoin Transfer';
      case 'share_token':
        return 'Sign Token Transfer';
      default:
        return 'Sign Transfer';
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (!hasPreparedRef.current && onPrepareRef.current) {
        hasPreparedRef.current = true;
        onPrepareRef.current();
      }
    } else {
      hasPreparedRef.current = false;
    }
  }, [isOpen]);

  const generateQrCode = useCallback(() => {
    if (!preparedTransaction || !wallet) {
      setError('Missing transaction data or wallet');
      setSigningStep('error');
      return;
    }

    const txForQr = formatTransactionForQr(preparedTransaction, wallet);
    if (!txForQr) {
      setError('Failed to format transaction for signing');
      setSigningStep('error');
      return;
    }

    setUnsignedTx(txForQr);

    const encoded = encodeEthereumTransaction(
      txForQr,
      wallet.derivationPath || undefined,
      wallet.masterFingerprint || undefined,
    );

    if (!encoded) {
      setError('Failed to encode transaction for signing. Make sure wallet has derivation path and fingerprint.');
      setSigningStep('error');
      return;
    }

    setQrData({ cborHex: encoded.cborHex, type: encoded.type });
    setSigningStep('show-qr');
  }, [preparedTransaction, wallet]);

  const submitSignedTransaction = useCallback(
    async (signedTransactionHex: string) => {
      if (!onBroadcast) return;

      setSigningStep('submitting');

      try {
        const hash = await onBroadcast(signedTransactionHex);
        setTxHash(hash);
        setSigningStep('success');
        onSuccess?.(hash);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to broadcast transaction');
        setSigningStep('error');
      }
    },
    [onBroadcast, onSuccess],
  );

  const { error: scannerError, stopScanner } = useQRScanner({
    scannerId: 'transfer-qr-scanner',
    onScanSuccess: (text) => {
      const signedTx = decodeKeystoneSignedTransaction(
        text,
        unsignedTx
          ? {
              to: unsignedTx.to,
              value: unsignedTx.value,
              gas: unsignedTx.gas,
              gasPrice: unsignedTx.gasPrice,
              nonce: unsignedTx.nonce,
              data: unsignedTx.data,
              chainId: unsignedTx.chainId,
            }
          : undefined,
      );
      if (signedTx) {
        submitSignedTransaction(signedTx);
      }
    },
    enabled: signingStep === 'scan-signature',
  });

  const handleClose = useCallback(() => {
    if (signingStep === 'submitting') return;
    stopScanner();
    onClose();
  }, [onClose, signingStep, stopScanner]);

  useEffect(() => {
    if (signingStep === 'success' && !isBitcoin) {
      const timer = setTimeout(() => {
        handleClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [signingStep, handleClose, isBitcoin]);

  const goBack = useCallback(() => {
    if (signingStep === 'scan-signature') {
      setSigningStep('show-qr');
    } else if (signingStep === 'show-qr') {
      setSigningStep('instructions');
    } else if (signingStep === 'error') {
      setSigningStep(isBitcoin ? 'sign-manual' : 'instructions');
      setError(null);
    }
  }, [signingStep, isBitcoin]);

  const renderStepContent = () => {
    if (signingStep === 'loading' || isPreparing) {
      return (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <SpinnerGapIcon size={ICON_XL} className="text-brand-mid animate-spin" />
            <p className="text-sm text-text-muted">Preparing transaction...</p>
          </div>
          <ModalActions>
            <PageAction label="Cancel" onClick={handleClose} />
          </ModalActions>
        </div>
      );
    }

    switch (signingStep) {
      case 'instructions':
        return (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              Sign this transfer with your hardware wallet to authorize the transaction.
            </p>

            <Rows>
              {token && (
                <Row label="Token">
                  {token.symbol} ({token.name})
                </Row>
              )}
              <Row label="From">
                <span className="font-mono text-xs">{formatWalletAddressMedium(wallet.address)}</span>
              </Row>
              {toAddress && (
                <Row label="To">
                  <span className="font-mono text-xs">{formatWalletAddressMedium(toAddress)}</span>
                </Row>
              )}
              {amount && (
                <Row label="Amount">
                  {amount} {token?.symbol ?? nativeSymbol}
                </Row>
              )}
            </Rows>

            <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
              <li>Scan the QR code with your hardware wallet</li>
              <li>Review and sign the transaction on your hardware wallet</li>
              <li>Scan the signature QR code from your hardware wallet</li>
            </ol>

            {error && <p className="text-sm text-error-light">{error}</p>}

            <ModalActions>
              <PageAction label="Cancel" onClick={handleClose} />
              <PageAction
                label="Continue"
                primary
                onClick={generateQrCode}
                disabled={!preparedTransaction || !wallet}
              />
            </ModalActions>
          </div>
        );

      case 'show-qr':
        return (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">Scan this QR code with your hardware wallet to sign the transfer.</p>

            {qrData && (
              <div className="flex justify-center py-2">
                <AnimatedQRCode cbor={qrData.cborHex} type={qrData.type} />
              </div>
            )}

            {error && <p className="text-sm text-error-light">{error}</p>}

            <ModalActions>
              <PageAction label="Back" onClick={goBack} />
              <PageAction label="I've Signed It" primary onClick={() => setSigningStep('scan-signature')} />
            </ModalActions>
          </div>
        );

      case 'sign-manual':
        if (!preparedTransaction || !('amountBtc' in preparedTransaction)) return null;
        return (
          <BitcoinSignStep
            prepared={preparedTransaction}
            signedTransaction={signedTransaction}
            onSignedTransactionChange={setSignedTransaction}
            onCancel={handleClose}
            onBroadcast={submitSignedTransaction}
          />
        );

      case 'scan-signature':
        return (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              Point your camera at the signature QR code on your hardware wallet.
            </p>

            <QRScannerView scannerId="transfer-qr-scanner" error={scannerError} />

            <ModalActions>
              <PageAction label="Back" onClick={goBack} />
            </ModalActions>
          </div>
        );

      case 'submitting':
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <SpinnerGapIcon size={ICON_XL} className="text-brand-mid animate-spin" />
            <p className="text-sm text-text-muted">Broadcasting transaction...</p>
            <p className="text-xs text-text-subtle">This may take a moment</p>
          </div>
        );

      case 'success': {
        const explorerUrl = txHash ? getBlockExplorerTxUrl(wallet.chain, txHash) : '';
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-medium text-success-light">
                <CheckCircleIcon size={ICON_MD} weight="fill" />
                Transfer Sent!
              </h3>
              <p className="text-sm text-text-muted">Your transaction has been submitted to the network.</p>
            </div>

            {txHash && (
              <div className="space-y-1 border-t border-border-subtle pt-3">
                <h3 className="text-sm font-medium text-text-primary">Transaction Hash</h3>
                <p className="text-xs font-mono text-text-primary break-all">{txHash}</p>
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-mid hover:text-brand-light"
                  >
                    View on block explorer
                    <ArrowSquareOutIcon size={ICON_XS} />
                  </a>
                )}
              </div>
            )}

            {isBitcoin && (
              <ModalActions>
                <PageAction label="Done" primary onClick={handleClose} />
              </ModalActions>
            )}
          </div>
        );
      }

      case 'error':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-medium text-error-light">
                <WarningCircleIcon size={ICON_MD} weight="fill" />
                Transfer Failed
              </h3>
              <p className="text-sm text-text-muted">{error || 'An error occurred'}</p>
            </div>
            <ModalActions>
              <PageAction label="Close" onClick={handleClose} />
              <PageAction label="Try Again" primary onClick={goBack} />
            </ModalActions>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={getTitle()}>
      {renderStepContent()}
    </Modal>
  );
}
