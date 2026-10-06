import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
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
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { particularsKey } from '../useRegisterParticulars';

type Draft = { file: File | null; name: string; address: string; asAt: string; reason: string };

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const COPY = REGISTER_PARTICULARS_COPY;
const FAILED = 'The change could not be prepared. Retry with the same details.';
const CLOSED = 'This particulars form is closed. Reopen it before continuing.';
const LABEL = 'block space-y-1 text-sm text-text-primary';
const EVIDENCE = 'application/pdf,image/png,image/jpeg';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function problemsOf(draft: Draft, today: string) {
  const problems: string[] = [];
  if (!draft.file) problems.push('Choose the supporting document.');
  if (!draft.name.trim() || !draft.address.trim()) problems.push('Give the name and the residential address.');
  if (!DAY.test(draft.asAt) || draft.asAt > today) problems.push('Enter an as-at date no later than today (UTC).');
  if (!draft.reason.trim()) problems.push('Give the reason for the change.');
  return problems;
}

export function ParticularsForm({
  owner,
  guard,
  company,
  member,
  appointment,
  blocked,
  onConflict,
  onMissing,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  member: string;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
  onMissing: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
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
    if (pending.current || busy || blocked || problems.length > 0 || !draft.file) return;
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
      try {
        check();
        const { data } = await prepareRegisterParticularsChange(apiClient, preparation, {
          ledovaSubmissionGuard: check,
        });
        check();
        if (!isPreparedRegisterParticularsChange(data, preparation))
          throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      } catch (failure) {
        if (failureStatus(failure) === 409) {
          operation.current = null;
          onConflict();
        }
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: particularsKey(owner, company) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
        if (failureStatus(failure) === 404) onMissing();
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
            {COPY.SUPPORTING_DOCUMENT}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => update({ file: event.target.files?.[0] ?? null })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.SUPPORTING_DOCUMENT_NOTE}</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">{COPY.PROPOSED_PARTICULARS}</legend>
          <label className={LABEL}>
            {COPY.NAME}
            <input
              value={draft.name}
              maxLength={255}
              className={FIELD_CLASS}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.RESIDENTIAL_ADDRESS}
            <input
              value={draft.address}
              maxLength={1000}
              className={FIELD_CLASS}
              onChange={(event) => update({ address: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.AS_AT}
            <input
              type="date"
              max={today}
              value={draft.asAt}
              className={FIELD_CLASS}
              onChange={(event) => update({ asAt: event.target.value })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.AS_AT_NOTE}</p>
        </fieldset>
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
        label={busy ? 'Preparing change…' : COPY.SUBMIT}
        disabled={busy || blocked || problems.length > 0}
        onClick={() => void submit()}
      />
    </form>
  );
}
