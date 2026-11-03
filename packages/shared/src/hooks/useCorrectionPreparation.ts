import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REGISTER_CORRECTION_COPY as COPY } from '../constants/business/register-corrections';
import { uploadRegisterEvidence } from '../services/register-commands';
import { prepareRegisterCorrection } from '../services/register-corrections';
import type {
  OwnCompanyAppointment,
  RegisterCorrectionAuthority,
  RegisterDocumentFile,
  RegisterEntry,
  RegisterEvidence,
} from '../types';
import { utcToday } from '../utils/date';
import { apiErrorSentence, createUserFriendlyError, failureStatus } from '../utils/errors';
import { isRegisterEvidenceReceipt } from '../utils/register-commands';
import { isPreparedRegisterCorrection } from '../utils/register-corrections';
import { useApiClient } from './useApiClient';
import { correctionsKey } from './useClassCorrections';
import { hasProblems, type Problems } from './useErrorSummary';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

type Draft = {
  file: RegisterDocumentFile | null;
  effectiveOn: string;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: RegisterDocumentFile; appointment: string; key: string; receipt: RegisterEvidence | null };

const FAILED = 'The correction could not be prepared. Retry with the same details.';

const CLOSED = 'This correction form is closed. Reopen it before continuing.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function problemsOf(
  draft: Draft,
  today: string,
): Problems<'file' | 'effectiveOn' | 'director' | 'reference' | 'reason'> {
  return {
    file: !draft.file && 'Choose the authority document.',
    effectiveOn:
      (!DAY.test(draft.effectiveOn) || draft.effectiveOn > today) &&
      'Enter an effective date no later than today (UTC).',
    director:
      draft.authority === 'director_resolution' &&
      !draft.director.trim() &&
      'Name the approving director for a resolution.',
    reference: !draft.reference.trim() && 'Give the authority reference.',
    reason: !draft.reason.trim() && 'Give the reason.',
  };
}

export type CorrectionPreparationOptions = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  entry: RegisterEntry;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
  onPrepared: (uuid: string) => void;
  newKey: () => string;
  session?: OrderSubmissionSession;
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
  onPrepared,
  newKey,
  session,
}: CorrectionPreparationOptions) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const today = utcToday();
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
  const config = () => ({ ...session?.requestConfig(), ledovaSubmissionGuard: check });
  const update = (patch: Partial<Draft>) => {
    setError('');
    setDraft((current) => ({ ...current, ...patch }));
  };
  const problems = problemsOf(draft, today);

  const upload = async (file: RegisterDocumentFile) => {
    const previous = uploaded.current;
    const same = previous?.file === file && previous.appointment === appointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : newKey();
    uploaded.current = { file, appointment: appointment.uuid, key, receipt: null };
    const request = {
      companyId: company,
      appointment: appointment.uuid,
      kind: 'authority' as const,
      idempotencyKey: key,
    };
    try {
      check();
      const { data } = await uploadRegisterEvidence(apiClient, { ...request, file }, config());
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
        correctsId: entry.uuid,
        authorityEvidence: evidence.uuid,
        effectiveOn: draft.effectiveOn,
        authority: draft.authority,
        approvingDirector: draft.authority === 'director_resolution' ? draft.director.trim() : '',
        authorityReference: draft.reference.trim(),
        reason: draft.reason.trim(),
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: newKey() };
      const preparation = { operationId: operation.current.key, ...request };
      let prepared = '';
      try {
        check();
        const { data } = await prepareRegisterCorrection(apiClient, preparation, config());
        check();
        if (!isPreparedRegisterCorrection(data, preparation))
          throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
        prepared = data.uuid;
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
      onPrepared(prepared);
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
