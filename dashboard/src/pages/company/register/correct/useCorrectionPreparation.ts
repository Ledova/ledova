import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterCorrection,
  isRegisterEvidenceReceipt,
  prepareRegisterCorrection,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterCorrectionAuthority,
  type RegisterEntry,
  type RegisterEvidence,
} from '@ledova/shared';

import apiClient from '@services/apiClient';
import { correctionsKey } from '@pages/company/register/shared/useClassCorrections';

type Draft = {
  file: File | null;
  effectiveOn: string;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

export const COPY = REGISTER_CORRECTION_COPY;

const FAILED = 'The correction could not be prepared. Retry with the same details.';

const CLOSED = 'This correction form is closed. Reopen it before continuing.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function problemsOf(draft: Draft, today: string) {
  const problems: string[] = [];
  if (!draft.file) problems.push('Choose the authority document.');
  if (!DAY.test(draft.effectiveOn) || draft.effectiveOn > today)
    problems.push('Enter an effective date no later than today (UTC).');
  if (draft.authority === 'director_resolution' && !draft.director.trim())
    problems.push('Name the approving director for a resolution.');
  if (!draft.reference.trim() || !draft.reason.trim()) problems.push('Give the authority reference and the reason.');
  return problems;
}

export type CorrectionFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  entry: RegisterEntry;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
};

export function useCorrectionPreparation({
  owner,
  guard,
  company,
  token,
  entry,
  appointment,
  blocked,
  onConflict,
}: CorrectionFormProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Draft>(() => ({
    file: null,
    effectiveOn: today,
    authority: 'director_resolution',
    director: '',
    reference: '',
    reason: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploaded = useRef<Upload | null>(null);
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw createUserFriendlyError(CLOSED);
  };
  const update = (patch: Partial<Draft>) => {
    setError('');
    setDraft((current) => ({ ...current, ...patch }));
  };
  const problems = problemsOf(draft, today);

  const upload = async (file: File) => {
    const previous = uploaded.current;
    const same = previous?.file === file && previous.appointment === appointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : crypto.randomUUID();
    uploaded.current = { file, appointment: appointment.uuid, key, receipt: null };
    const request = {
      companyId: company,
      appointment: appointment.uuid,
      kind: 'authority' as const,
      idempotencyKey: key,
    };
    try {
      check();
      const { data } = await uploadRegisterEvidence(apiClient, { ...request, file }, { ledovaSubmissionGuard: check });
      check();
      if (!isRegisterEvidenceReceipt(data, request, file.size)) {
        uploaded.current = null;
        throw createUserFriendlyError(COPY.UPLOAD_RECEIPT_FAILED);
      }
      uploaded.current = { file, appointment: appointment.uuid, key, receipt: data };
      return data;
    } catch (failure) {
      if (failureStatus(failure) === 409) uploaded.current = null;
      throw failure;
    }
  };

  const submit = async () => {
    if (pending.current || busy || blocked || problems.length > 0 || !draft.file) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      const evidence = await upload(draft.file);
      const request = {
        appointment: appointment.uuid,
        correctsId: entry.uuid,
        authorityEvidence: evidence.uuid,
        effectiveOn: draft.effectiveOn,
        authority: draft.authority,
        approvingDirector: draft.authority === 'director_resolution' ? draft.director.trim() : '',
        authorityReference: draft.reference.trim(),
        reason: draft.reason.trim(),
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      const preparation = { operationId: operation.current.key, ...request };
      try {
        check();
        const { data } = await prepareRegisterCorrection(apiClient, preparation, { ledovaSubmissionGuard: check });
        check();
        if (!isPreparedRegisterCorrection(data, preparation))
          throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      } catch (failure) {
        if (failureStatus(failure) === 409) {
          operation.current = null;
          onConflict();
        }
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: correctionsKey(owner, token) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { today, draft, busy, error, update, problems, submit } as const;
}
