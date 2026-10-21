import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  REGISTER_PARTICULARS_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterParticularsChange,
  isRegisterEvidenceReceipt,
  prepareRegisterParticularsChange,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  utcToday,
} from '@ledova/shared';

import apiClient from '@services/apiClient';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';
import { particularsKey } from '@pages/company/ledger/shared/useRegisterParticulars';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

type Draft = { file: File | null; name: string; address: string; asAt: string; reason: string };

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

export const COPY = REGISTER_PARTICULARS_COPY;

const FAILED = 'The change could not be prepared. Retry with the same details.';

const CLOSED = 'This particulars form is closed. Reopen it before continuing.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function problemsOf(draft: Draft, today: string): Problems<'file' | 'name' | 'address' | 'asAt' | 'reason'> {
  return {
    file: !draft.file && 'Choose the supporting document.',
    name: !draft.name.trim() && 'Give the name.',
    address: !draft.address.trim() && 'Give the residential address.',
    asAt: (!DAY.test(draft.asAt) || draft.asAt > today) && 'Enter an as-at date no later than today (UTC).',
    reason: !draft.reason.trim() && 'Give the reason for the change.',
  };
}

export type ParticularsFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  member: string;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
  onMissing: () => void;
};

export function useParticularsPreparation({
  owner,
  guard,
  company,
  member,
  appointment,
  blocked,
  onConflict,
  onMissing,
}: ParticularsFormProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = utcToday();
  const [draft, setDraft] = useState<Draft>(() => ({ file: null, name: '', address: '', asAt: today, reason: '' }));
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
      kind: 'supporting' as const,
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
    if (pending.current || busy || blocked || hasProblems(problems) || !draft.file) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      const evidence = await upload(draft.file);
      const request = {
        appointment: appointment.uuid,
        member,
        supportingEvidence: evidence.uuid,
        name: draft.name.trim(),
        residentialAddress: draft.address.trim(),
        asAt: draft.asAt,
        reason: draft.reason.trim(),
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      const preparation = { operationId: operation.current.key, ...request };
      let prepared = '';
      try {
        check();
        const { data } = await prepareRegisterParticularsChange(apiClient, preparation, {
          ledovaSubmissionGuard: check,
        });
        check();
        if (!isPreparedRegisterParticularsChange(data, preparation))
          throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
        prepared = data.uuid;
      } catch (failure) {
        if (failureStatus(failure) === 409) operation.current = null;
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: particularsKey(owner, company) });
      check();
      const place = registerPlace({
        company,
        task: 'history',
        record: prepared,
        outcome: 'Particulars change prepared.',
      });
      navigate(place.to, { state: place.state });
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
        if (failureStatus(failure) === 409) onConflict();
        if (failureStatus(failure) === 404) onMissing();
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
