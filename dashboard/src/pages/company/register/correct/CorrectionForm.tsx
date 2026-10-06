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
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { correctionsKey } from '../useRegisterCorrections';

type Draft = {
  file: File | null;
  effectiveOn: string;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const COPY = REGISTER_CORRECTION_COPY;
const FAILED = 'The correction could not be prepared. Retry with the same details.';
const CLOSED = 'This correction form is closed. Reopen it before continuing.';
const LABEL = 'block space-y-1 text-sm text-text-primary';
const EVIDENCE = 'application/pdf,image/png,image/jpeg';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

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

export function CorrectionForm({
  owner,
  guard,
  company,
  token,
  entry,
  appointment,
  blocked,
  onConflict,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  entry: RegisterEntry;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
}) {
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

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Evidence provided by the company</legend>
          <label className={LABEL}>
            {COPY.AUTHORITY_DOCUMENT}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => update({ file: event.target.files?.[0] ?? null })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.AUTHORITY_DOCUMENT_NOTE}</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Effective date and authority</legend>
          <label className={LABEL}>
            {COPY.EFFECTIVE_ON}
            <input
              type="date"
              max={today}
              value={draft.effectiveOn}
              className={FIELD_CLASS}
              onChange={(event) => update({ effectiveOn: event.target.value })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.EFFECTIVE_ON_NOTE}</p>
          <label className={LABEL}>
            {COPY.AUTHORITY}
            <select
              value={draft.authority}
              className={FIELD_CLASS}
              onChange={(event) => update({ authority: event.target.value as RegisterCorrectionAuthority })}
            >
              {AUTHORITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {draft.authority === 'director_resolution' && (
            <label className={LABEL}>
              {COPY.APPROVING_DIRECTOR}
              <input
                value={draft.director}
                maxLength={255}
                className={FIELD_CLASS}
                onChange={(event) => update({ director: event.target.value })}
              />
            </label>
          )}
          <label className={LABEL}>
            {COPY.AUTHORITY_REFERENCE}
            <input
              value={draft.reference}
              maxLength={255}
              className={FIELD_CLASS}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.REASON}
            <textarea
              rows={3}
              value={draft.reason}
              maxLength={1000}
              className={FIELD_CLASS}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </label>
        </fieldset>
      </fieldset>
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <PageAction
        label={busy ? 'Preparing correction…' : COPY.SUBMIT}
        disabled={busy || blocked || problems.length > 0}
        onClick={() => void submit()}
      />
    </form>
  );
}
