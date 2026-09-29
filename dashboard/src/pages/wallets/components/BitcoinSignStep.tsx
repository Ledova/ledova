import { useState } from 'react';
import { formatWalletAddressMedium, normalizeBitcoinRawTransactionHex } from '@ledova/shared';
import type { PrepareBitcoinTransferResponse } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { ModalActions } from '@components/Modal';
import { PageAction } from '@components/Page';

interface BitcoinSignStepProps {
  prepared: PrepareBitcoinTransferResponse;
  signedTransaction: string;
  onSignedTransactionChange: (value: string) => void;
  onCancel: () => void;
  onBroadcast: (signedTransactionHex: string) => void;
}

const INSTRUCTIONS = [
  'In your own Bitcoin wallet software, build a transaction from this address that pays the amount below to the recipient at the fee rate shown.',
  'Sign it there and export the signed raw transaction as hex.',
  'Paste the signed hex below and broadcast it to the network.',
];

export const INVALID_SIGNED_HEX_MESSAGE =
  'Enter the signed raw transaction as hex (whole bytes; an optional 0x prefix is removed).';

export function BitcoinSignStep({
  prepared,
  signedTransaction,
  onSignedTransactionChange,
  onCancel,
  onBroadcast,
}: BitcoinSignStepProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleBroadcast = () => {
    const normalized = normalizeBitcoinRawTransactionHex(signedTransaction);
    if (!normalized) {
      setValidationError(INVALID_SIGNED_HEX_MESSAGE);
      return;
    }
    setValidationError(null);
    onBroadcast(normalized);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        This app does not build or sign Bitcoin transactions. Sign with your own wallet software and paste the result.
      </p>

      <Rows>
        <Row label="From">
          <span className="font-mono text-xs">{formatWalletAddressMedium(prepared.fromAddress)}</span>
        </Row>
        <Row label="To">
          <span className="break-all font-mono text-xs">{prepared.toAddress}</span>
        </Row>
        <Row label="Amount">{prepared.amountBtc} BTC</Row>
        <Row label="Fee rate">{prepared.feePerByte} sat/vB</Row>
        <Row label="Estimated size">{prepared.estimatedTxSize} vB</Row>
        <Row label="Fee">{prepared.feeBtc} BTC</Row>
        <Row label="Total">{prepared.totalCostBtc} BTC</Row>
      </Rows>

      <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
        {INSTRUCTIONS.map((instruction) => (
          <li key={instruction}>{instruction}</li>
        ))}
      </ol>

      <div className="space-y-1">
        <label htmlFor="bitcoin-signed-transaction" className="text-sm font-medium text-text-primary">
          Signed transaction (hex)
        </label>
        <textarea
          id="bitcoin-signed-transaction"
          value={signedTransaction}
          onChange={(event) => onSignedTransactionChange(event.target.value)}
          placeholder="02000000..."
          rows={4}
          spellCheck={false}
          className="block w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid"
        />
        {validationError && <p className="text-xs text-error-light">{validationError}</p>}
      </div>

      <ModalActions>
        <PageAction label="Cancel" onClick={onCancel} />
        <PageAction
          label="Broadcast"
          primary
          onClick={handleBroadcast}
          disabled={signedTransaction.trim().length === 0}
        />
      </ModalActions>
    </div>
  );
}
