import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import {
  MAX_REQUEST_SHARES,
  createCapitalIncrease,
  formatShareCount,
  getErrorMessage,
  raisedSupply,
  requestShares,
  type CompanyShareToken,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { FIELD_CLASS } from '@components/fieldClass';

interface RequestProps {
  token: CompanyShareToken;
  classRead: { isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
  guard: () => void;
  epoch?: number;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

function useRequestGuard(guard: () => void) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => {
    if (!mounted.current) throw new Error('The owner request is no longer open.');
    guard();
  };
}

function ClassReadState({ query }: { query: RequestProps['classRead'] }) {
  if (!query.isError)
    return query.isFetching ? (
      <p role="status" className="text-sm text-text-muted">
        Refreshing class state before continuing.
      </p>
    ) : null;
  return (
    <div role="alert" className="space-y-2 text-sm text-error-light">
      <p>The class state could not be refreshed. Your draft is kept; retry before submitting.</p>
      <PageAction label="Retry class state" onClick={() => void query.refetch()} disabled={query.isFetching} />
    </div>
  );
}

export function RaiseSharesForm({ token, classRead, guard, epoch, onClose, onSuccess }: RequestProps) {
  const guardRequest = useRequestGuard(guard);
  const config = { ledovaSubmissionGuard: guardRequest, ledovaSessionEpoch: epoch };
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [boardReference, setBoardReference] = useState('');
  const [shareholderReference, setShareholderReference] = useState('');
  const additionalShares = requestShares(additional);
  const newTotal = raisedSupply(token.totalSupply, additional);
  const newAuthorizedTotal = newTotal === null ? null : requestShares(newTotal);
  const valid =
    token.isOwner &&
    !classRead.isError &&
    !classRead.isFetching &&
    token.status === 'deployed' &&
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    purpose.trim() !== '' &&
    boardReference.trim() !== '';
  const request = useMutation({
    mutationFn: async () => {
      guardRequest();
      const response = await createCapitalIncrease(
        apiClient,
        {
          token: token.uuid,
          additionalShares: additionalShares!,
          newAuthorizedTotal: newAuthorizedTotal!,
          purpose: purpose.trim(),
          boardResolutionReference: boardReference.trim(),
          shareholderApprovalReference: shareholderReference.trim() || undefined,
        },
        config,
      );
      guardRequest();
      return response;
    },
    onSuccess: async () => {
      guardRequest();
      await onSuccess();
      guardRequest();
      onClose();
    },
  });
  return (
    <Modal
      isOpen
      onClose={() => {
        if (!request.isPending) onClose();
      }}
      title="Raise authorised shares"
      showFooter
      confirmLabel="Create request"
      onConfirm={() => {
        if (valid && !request.isPending) request.mutate();
      }}
      confirmDisabled={!valid || request.isPending}
      confirmLoading={request.isPending}
    >
      <fieldset disabled={request.isPending} className="space-y-4">
        <ClassReadState query={classRead} />
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
      </fieldset>
    </Modal>
  );
}
