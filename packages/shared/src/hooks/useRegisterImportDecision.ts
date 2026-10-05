import { useEffect, useRef, useState } from 'react';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { REGISTER_IMPORT_COPY, REGISTER_IMPORT_UNMET_COPY } from '../constants/business/register-imports';
import { decideRegisterImport, previewRegisterImportDecision } from '../services/register-imports';
import type {
  RegisterImport,
  RegisterImportDecideRequest,
  RegisterImportDecisionKind,
  RegisterImportDecisionPreview,
} from '../types';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import { isRegisterImportDecisionReceipt } from '../utils/register-imports';

export type RegisterImportDecisionTarget = {
  uuid: string;
  signature: string;
  request: RegisterImportDecideRequest;
  preview: RegisterImportDecisionPreview;
};

export type RegisterImportDecisionOptions = {
  appointment: string | undefined;
  newKey: () => string;
  guard: () => void;
  requestConfig?: () => AxiosRequestConfig;
  onDecided: (proposal: RegisterImport) => Promise<unknown> | void;
  onRefused?: () => Promise<unknown> | void;
};

function statusOf(failure: unknown) {
  return (failure as { response?: { status?: number } })?.response?.status;
}

function refusal(failure: unknown) {
  const codes = (failure as { response?: { data?: { unmetRequirements?: unknown } } })?.response?.data
    ?.unmetRequirements;
  if (!Array.isArray(codes) || !codes.length) return null;
  return [
    ...new Set(codes.map((code) => REGISTER_IMPORT_UNMET_COPY[String(code)] ?? REGISTER_IMPORT_COPY.DECIDE_FAILED)),
  ].join(' ');
}

export function useRegisterImportDecision(
  apiClient: AxiosInstance,
  proposal: Pick<RegisterImport, 'uuid'> | undefined,
  options: RegisterImportDecisionOptions,
) {
  const mounted = useRef(true);
  const pending = useRef(false);
  const confirmation = useRef<RegisterImportDecisionTarget | null>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [target, setTarget] = useState<RegisterImportDecisionTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmation.current = null;
      retry.current = null;
    };
  }, []);
  const settle = (next: RegisterImportDecisionTarget | null) => {
    confirmation.current = next;
    if (mounted.current) setTarget(next);
  };
  const open = async (kind: RegisterImportDecisionKind, reason = '') => {
    if (pending.current || !proposal || !options.appointment) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    settle(null);
    try {
      options.guard();
      const request = { appointment: options.appointment, kind, reason };
      const response = await previewRegisterImportDecision(
        apiClient,
        proposal.uuid,
        request,
        options.requestConfig?.() ?? {},
      );
      options.guard();
      const signature = JSON.stringify([proposal.uuid, kind, request.appointment, reason, response.data.previewDigest]);
      const key = retry.current?.signature === signature ? retry.current.key : options.newKey();
      settle({
        uuid: proposal.uuid,
        signature,
        preview: response.data,
        request: { ...request, idempotencyKey: key, previewDigest: response.data.previewDigest, confirmation: true },
      });
    } catch (failure) {
      if (mounted.current) setError(getErrorMessage(failure, REGISTER_IMPORT_COPY.PREVIEW_FAILED));
      const status = statusOf(failure);
      if (status === 400 || status === 404) await options.onRefused?.();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const confirm = async () => {
    const current = confirmation.current;
    if (pending.current || !current || !current.preview.canDecide) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      options.guard();
      retry.current = { signature: current.signature, key: current.request.idempotencyKey };
      const response = await decideRegisterImport(apiClient, current.uuid, current.request, {
        ...(options.requestConfig?.() ?? {}),
        ledovaSubmissionGuard: options.guard,
      });
      options.guard();
      if (!isRegisterImportDecisionReceipt(response.data, current.uuid, current.request))
        throw createUserFriendlyError(REGISTER_IMPORT_COPY.DECISION_RECEIPT_FAILED);
      retry.current = null;
      settle(null);
      await options.onDecided(response.data);
    } catch (failure) {
      const status = statusOf(failure);
      if (status && status < 500) retry.current = null;
      settle(null);
      if (mounted.current) setError(refusal(failure) ?? getErrorMessage(failure, REGISTER_IMPORT_COPY.DECIDE_FAILED));
      if (status === 400 || status === 404 || status === 409) await options.onRefused?.();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return {
    target,
    busy,
    error,
    open,
    confirm,
    cancel: () => {
      if (!pending.current) settle(null);
    },
  };
}
