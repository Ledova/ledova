import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import {
  createCapitalIncrease,
  formatShareCount,
  getErrorMessage,
  issueCompanyShares,
  type CompanyShareToken,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { MAX_REQUEST_SHARES, raisedSupply, requestShares } from './shareQuantities';

const FIELD_CLASS =
  'mt-1 block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary';
const LIMIT_COPY = `Each request supports up to ${formatShareCount(MAX_REQUEST_SHARES.toString())} shares.`;

interface RequestProps {
  token: CompanyShareToken;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

export function IssueSharesForm({ token, onClose, onSuccess }: RequestProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const quantity = requestShares(amount);
  const valid = token.status === 'deployed' && recipient.trim() !== '' && quantity !== null;
  const request = useMutation({
    mutationFn: () =>
      issueCompanyShares(apiClient, token.uuid, {
        recipient: recipient.trim(),
        amount: quantity!,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      await onSuccess();
      onClose();
    },
  });
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Request ${token.symbol} issuance`}
      showFooter
      confirmLabel="Submit issuance request"
      onConfirm={() => {
        if (valid) request.mutate();
      }}
      confirmDisabled={!valid || request.isPending}
      confirmLoading={request.isPending}
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">Staff review this request before any shares are issued.</p>
        {request.isError && (
          <p role="alert" className="text-sm text-error-light">
            {getErrorMessage(request.error, 'The issuance request was refused. Try again.')}
          </p>
        )}
        <label className="block text-sm">
          Recipient address
          <input className={FIELD_CLASS} value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </label>
        <label className="block text-sm">
          Shares to issue
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <p className="text-xs text-text-muted">{LIMIT_COPY} Enter a positive whole number.</p>
        {amount !== '' && quantity === null && (
          <p role="alert" className="text-sm text-error-light">
            The quantity must be a whole number from 1 to {formatShareCount(MAX_REQUEST_SHARES.toString())}.
          </p>
        )}
        <label className="block text-sm">
          Reason (optional)
          <input className={FIELD_CLASS} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        {token.status !== 'deployed' && (
          <p role="alert" className="text-sm text-error-light">
            The class must be deployed and unpaused before you request issuance.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function RaiseSharesForm({ token, onClose, onSuccess }: RequestProps) {
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [boardReference, setBoardReference] = useState('');
  const [shareholderReference, setShareholderReference] = useState('');
  const additionalShares = requestShares(additional);
  const newTotal = raisedSupply(token.totalSupply, additional);
  const newAuthorizedTotal = newTotal === null ? null : requestShares(newTotal);
  const valid =
    token.status === 'deployed' &&
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    purpose.trim() !== '' &&
    boardReference.trim() !== '';
  const request = useMutation({
    mutationFn: () =>
      createCapitalIncrease(apiClient, {
        token: token.uuid,
        additionalShares: additionalShares!,
        newAuthorizedTotal: newAuthorizedTotal!,
        purpose: purpose.trim(),
        boardResolutionReference: boardReference.trim(),
        shareholderApprovalReference: shareholderReference.trim() || undefined,
      }),
    onSuccess: async () => {
      await onSuccess();
      onClose();
    },
  });
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Raise authorised shares"
      showFooter
      confirmLabel="Create request"
      onConfirm={() => {
        if (valid) request.mutate();
      }}
      confirmDisabled={!valid || request.isPending}
      confirmLoading={request.isPending}
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          Create a request, then submit it for staff review. Staff approval and execution raise the authorised cap; they
          do not issue shares.
        </p>
        <p className="text-sm text-text-primary">Current authorised shares: {formatShareCount(token.totalSupply)}</p>
        {request.isError && (
          <p role="alert" className="text-sm text-error-light">
            {getErrorMessage(request.error, 'The request was refused. Try again.')}
          </p>
        )}
        <label className="block text-sm">
          Additional shares
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={additional}
            onChange={(event) => setAdditional(event.target.value)}
          />
        </label>
        {newTotal !== null && (
          <p className="break-words text-sm text-text-primary">New authorised total: {formatShareCount(newTotal)}</p>
        )}
        <p className="text-xs text-text-muted">
          The new authorised total must be at most {formatShareCount(MAX_REQUEST_SHARES.toString())} shares under the
          current request limit.
        </p>
        {additional !== '' && (additionalShares === null || newAuthorizedTotal === null) && (
          <p role="alert" className="text-sm text-error-light">
            Enter positive whole shares within the supported request limit.
          </p>
        )}
        <label className="block text-sm">
          Purpose
          <input className={FIELD_CLASS} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
        <label className="block text-sm">
          Board resolution reference
          <input
            className={FIELD_CLASS}
            value={boardReference}
            onChange={(event) => setBoardReference(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Shareholder approval reference (optional)
          <input
            className={FIELD_CLASS}
            value={shareholderReference}
            onChange={(event) => setShareholderReference(event.target.value)}
          />
        </label>
        {token.status !== 'deployed' && (
          <p role="alert" className="text-sm text-error-light">
            The class must be deployed and unpaused before you request a raise.
          </p>
        )}
      </div>
    </Modal>
  );
}
