import { useEffect, useRef, useState } from 'react';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { REGISTER_RECONCILIATION_COPY } from '../constants/business/register-reconciliations';
import { acknowledgeRegisterDiscrepancy } from '../services/register-reconciliations';
import type { RegisterReconciliation } from '../types';
import { apiErrorSentence, createUserFriendlyError, getErrorMessage } from '../utils/errors';
import { failureStatus } from '../utils/register-commands';
import { isDiscrepancyAcknowledgementReceipt } from '../utils/register-reconciliations';

export type DiscrepancyAcknowledgementOptions = {
  appointment: string | undefined;
  newKey: () => string;
  guard: () => void;
  requestConfig?: () => AxiosRequestConfig;
  onAcknowledged: (reconciliation: RegisterReconciliation) => Promise<unknown> | void;
  onRefused?: () => Promise<unknown> | void;
};

export function useDiscrepancyAcknowledgement(
  apiClient: AxiosInstance,
  reconciliation: Pick<RegisterReconciliation, 'uuid'> | undefined,
  options: DiscrepancyAcknowledgementOptions,
) {
  const mounted = useRef(true);
  const pending = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      retry.current = null;
    };
  }, []);
  const acknowledge = async (discrepancy: number, reason: string) => {
    if (pending.current || !reconciliation || !options.appointment) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      options.guard();
      const signature = JSON.stringify([reconciliation.uuid, discrepancy, options.appointment, reason]);
      const key = retry.current?.signature === signature ? retry.current.key : options.newKey();
      retry.current = { signature, key };
      const request = { appointment: options.appointment, discrepancy, reason, idempotencyKey: key };
      const response = await acknowledgeRegisterDiscrepancy(apiClient, reconciliation.uuid, request, {
        ...(options.requestConfig?.() ?? {}),
        ledovaSubmissionGuard: options.guard,
      });
      options.guard();
      if (!isDiscrepancyAcknowledgementReceipt(response.data, reconciliation.uuid, request))
        throw createUserFriendlyError(REGISTER_RECONCILIATION_COPY.ACKNOWLEDGEMENT_RECEIPT_FAILED);
      retry.current = null;
      await options.onAcknowledged(response.data);
    } catch (failure) {
      const status = failureStatus(failure);
      if (status && status < 500) retry.current = null;
      const fallback = REGISTER_RECONCILIATION_COPY.ACKNOWLEDGE_FAILED;
      if (mounted.current) setError(status ? apiErrorSentence(failure, fallback) : getErrorMessage(failure, fallback));
      if (status === 400 || status === 404 || status === 409) await options.onRefused?.();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, acknowledge };
}
