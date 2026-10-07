import { useEffect, useRef, useState } from 'react';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { REGISTER_CORRECTION_COPY, REGISTER_CORRECTION_UNMET_COPY } from '../constants/business/register-corrections';
import { REGISTER_IMPORT_COPY, REGISTER_IMPORT_UNMET_COPY } from '../constants/business/register-imports';
import { REGISTER_LINK_COPY, REGISTER_LINK_UNMET_COPY } from '../constants/business/register-links';
import { REGISTER_OPENING_COPY, REGISTER_OPENING_UNMET_COPY } from '../constants/business/register-openings';
import { REGISTER_PARTICULARS_COPY, REGISTER_PARTICULARS_UNMET_COPY } from '../constants/business/register-particulars';
import { REGISTER_GRANT_COPY, REGISTER_GRANT_UNMET_COPY } from '../constants/business/register-grants';
import { REGISTER_TRANSFER_COPY, REGISTER_TRANSFER_UNMET_COPY } from '../constants/business/register-transfers';
import { decideRegisterTransfer, previewRegisterTransferDecision } from '../services/register-transfers';
import { decideRegisterGrant, previewRegisterGrantDecision } from '../services/register-grants';
import { decideRegisterCorrection, previewRegisterCorrectionDecision } from '../services/register-corrections';
import { decideRegisterImport, previewRegisterImportDecision } from '../services/register-imports';
import { decideRegisterLink, previewRegisterLinkDecision } from '../services/register-links';
import { decideRegisterOpening, previewRegisterOpeningDecision } from '../services/register-openings';
import {
  decideRegisterParticularsChange,
  previewRegisterParticularsChangeDecision,
} from '../services/register-particulars';
import type {
  RegisterCorrection,
  RegisterCorrectionDecisionPreview,
  RegisterDecideRequest,
  RegisterDecisionKind,
  RegisterDecisionRequest,
  RegisterImport,
  RegisterImportDecisionPreview,
  RegisterGrant,
  RegisterGrantDecisionPreview,
  RegisterTransfer,
  RegisterTransferDecisionPreview,
  RegisterLink,
  RegisterLinkDecisionPreview,
  RegisterOpening,
  RegisterOpeningDecisionPreview,
  RegisterParticularsChange,
  RegisterParticularsChangeDecisionPreview,
} from '../types';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import { failureStatus, isRegisterDecisionReceipt } from '../utils/register-commands';
import { isRegisterCorrectionDecisionReceipt } from '../utils/register-corrections';
import { isRegisterGrantDecisionReceipt } from '../utils/register-grants';
import { isRegisterTransferDecisionReceipt } from '../utils/register-transfers';

type DecisionPreview = { previewDigest: string; canDecide: boolean };

export type RegisterDecisionFamily<Proposal, Preview extends DecisionPreview> = {
  preview: (
    apiClient: AxiosInstance,
    uuid: string,
    data: RegisterDecisionRequest,
    config?: AxiosRequestConfig,
  ) => Promise<{ data: Preview }>;
  decide: (
    apiClient: AxiosInstance,
    uuid: string,
    data: RegisterDecideRequest,
    config?: AxiosRequestConfig,
  ) => Promise<{ data: Proposal }>;
  isReceipt: (proposal: Proposal, uuid: string, request: RegisterDecideRequest) => boolean;
  unmet: Record<string, string>;
  copy: { PREVIEW_FAILED: string; DECIDE_FAILED: string; DECISION_RECEIPT_FAILED: string };
};

export const REGISTER_IMPORT_DECISIONS: RegisterDecisionFamily<RegisterImport, RegisterImportDecisionPreview> = {
  preview: previewRegisterImportDecision,
  decide: decideRegisterImport,
  isReceipt: isRegisterDecisionReceipt,
  unmet: REGISTER_IMPORT_UNMET_COPY,
  copy: REGISTER_IMPORT_COPY,
};

export const REGISTER_GRANT_DECISIONS: RegisterDecisionFamily<RegisterGrant, RegisterGrantDecisionPreview> = {
  preview: previewRegisterGrantDecision,
  decide: decideRegisterGrant,
  isReceipt: isRegisterGrantDecisionReceipt,
  unmet: REGISTER_GRANT_UNMET_COPY,
  copy: REGISTER_GRANT_COPY,
};

export const REGISTER_TRANSFER_DECISIONS: RegisterDecisionFamily<RegisterTransfer, RegisterTransferDecisionPreview> = {
  preview: previewRegisterTransferDecision,
  decide: decideRegisterTransfer,
  isReceipt: isRegisterTransferDecisionReceipt,
  unmet: REGISTER_TRANSFER_UNMET_COPY,
  copy: REGISTER_TRANSFER_COPY,
};

export const REGISTER_CORRECTION_DECISIONS: RegisterDecisionFamily<
  RegisterCorrection,
  RegisterCorrectionDecisionPreview
> = {
  preview: previewRegisterCorrectionDecision,
  decide: decideRegisterCorrection,
  isReceipt: isRegisterCorrectionDecisionReceipt,
  unmet: REGISTER_CORRECTION_UNMET_COPY,
  copy: REGISTER_CORRECTION_COPY,
};

export const REGISTER_LINK_DECISIONS: RegisterDecisionFamily<RegisterLink, RegisterLinkDecisionPreview> = {
  preview: previewRegisterLinkDecision,
  decide: decideRegisterLink,
  isReceipt: isRegisterDecisionReceipt,
  unmet: REGISTER_LINK_UNMET_COPY,
  copy: REGISTER_LINK_COPY,
};

export const REGISTER_OPENING_DECISIONS: RegisterDecisionFamily<RegisterOpening, RegisterOpeningDecisionPreview> = {
  preview: previewRegisterOpeningDecision,
  decide: decideRegisterOpening,
  isReceipt: isRegisterDecisionReceipt,
  unmet: REGISTER_OPENING_UNMET_COPY,
  copy: REGISTER_OPENING_COPY,
};

export const REGISTER_PARTICULARS_DECISIONS: RegisterDecisionFamily<
  RegisterParticularsChange,
  RegisterParticularsChangeDecisionPreview
> = {
  preview: previewRegisterParticularsChangeDecision,
  decide: decideRegisterParticularsChange,
  isReceipt: isRegisterDecisionReceipt,
  unmet: REGISTER_PARTICULARS_UNMET_COPY,
  copy: REGISTER_PARTICULARS_COPY,
};

export type RegisterDecisionTarget<Preview> = {
  uuid: string;
  signature: string;
  request: RegisterDecideRequest;
  preview: Preview;
};

export type RegisterDecisionOptions<Proposal> = {
  appointment: string | undefined;
  newKey: () => string;
  guard: () => void;
  requestConfig?: () => AxiosRequestConfig;
  onDecided: (proposal: Proposal) => Promise<unknown> | void;
  onRefused?: () => Promise<unknown> | void;
};

function refusal(failure: unknown, unmet: Record<string, string>, fallback: string) {
  const codes = (failure as { response?: { data?: { unmetRequirements?: unknown } } })?.response?.data
    ?.unmetRequirements;
  if (!Array.isArray(codes) || !codes.length) return null;
  return [...new Set(codes.map((code) => unmet[String(code)] ?? fallback))].join(' ');
}

export function useRegisterDecision<Proposal, Preview extends DecisionPreview>(
  apiClient: AxiosInstance,
  family: RegisterDecisionFamily<Proposal, Preview>,
  proposal: { uuid: string } | undefined,
  options: RegisterDecisionOptions<Proposal>,
) {
  const mounted = useRef(true);
  const pending = useRef(false);
  const confirmation = useRef<RegisterDecisionTarget<Preview> | null>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [target, setTarget] = useState<RegisterDecisionTarget<Preview> | null>(null);
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
  const settle = (next: RegisterDecisionTarget<Preview> | null) => {
    confirmation.current = next;
    if (mounted.current) setTarget(next);
  };
  const open = async (kind: RegisterDecisionKind, reason = '') => {
    if (pending.current || !proposal || !options.appointment) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    settle(null);
    let refused = false;
    try {
      options.guard();
      const request = { appointment: options.appointment, kind, reason };
      const response = await family.preview(apiClient, proposal.uuid, request, options.requestConfig?.() ?? {});
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
      if (mounted.current) setError(getErrorMessage(failure, family.copy.PREVIEW_FAILED));
      const status = failureStatus(failure);
      refused = status === 400 || status === 404;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
    if (refused) await options.onRefused?.();
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
      const response = await family.decide(apiClient, current.uuid, current.request, {
        ...(options.requestConfig?.() ?? {}),
        ledovaSubmissionGuard: options.guard,
      });
      options.guard();
      if (!family.isReceipt(response.data, current.uuid, current.request))
        throw createUserFriendlyError(family.copy.DECISION_RECEIPT_FAILED);
      retry.current = null;
      settle(null);
      await options.onDecided(response.data);
    } catch (failure) {
      const status = failureStatus(failure);
      if (status && status < 500) retry.current = null;
      settle(null);
      if (mounted.current)
        setError(
          refusal(failure, family.unmet, family.copy.DECIDE_FAILED) ??
            getErrorMessage(failure, family.copy.DECIDE_FAILED),
        );
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
