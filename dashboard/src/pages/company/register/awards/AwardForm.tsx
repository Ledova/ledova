import { useEffect, useRef, useState } from 'react';
import {
  REGISTER_AWARD_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterAward,
  isRecordedRegisterAward,
  isRegisterEvidenceReceipt,
  recordRegisterAward,
  uploadRegisterEvidence,
  type OwnCompanyAppointment,
  type RegisterAwardPreparation,
  type RegisterEvidence,
  type RegisterTransferMember,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';

const LABEL = 'block space-y-1 text-sm text-text-primary';

export function AwardForm({
  company,
  token,
  members,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
}: {
  company: string;
  token: string;
  members: RegisterTransferMember[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
}) {
  const [memberId] = useState(() => crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState('');
  const [schedule, setSchedule] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const pending = useRef(false);
  const upload = useRef<{ file: File; key: string; receipt: RegisterEvidence | null } | null>(null);
  const operation = useRef<{ request: RegisterAwardPreparation; confirmed: boolean; uncertain: boolean } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!live.current) throw createUserFriendlyError('This award form is closed. Reopen it before continuing.');
  };
  const today = new Date().toISOString().slice(0, 10);
  const problem =
    member === 'new' && (!name.trim() || !address.trim())
      ? 'Give the promised recipient’s name and residential address.'
      : !/^[1-9]\d*$/.test(shares) || BigInt(shares) >= 2n ** 256n
        ? 'Enter a positive whole number of promised shares.'
        : !/^\d{4}-\d{2}-\d{2}$/.test(termsOn) || termsOn > today
          ? 'Enter an agreement date no later than today (UTC).'
          : !terms.trim() || !schedule.trim() || !file
            ? 'Give the agreement terms, recorded schedule and agreement document.'
            : null;
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && (problem || !file))) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        if (!file) return;
        if (upload.current?.file !== file) upload.current = { file, key: crypto.randomUUID(), receipt: null };
        const request = {
          companyId: company,
          appointment: appointment.uuid,
          kind: 'supporting' as const,
          idempotencyKey: upload.current.key,
        };
        if (!upload.current.receipt) {
          const { data } = await uploadRegisterEvidence(
            apiClient,
            { ...request, file },
            { ledovaSubmissionGuard: check },
          );
          check();
          if (!isRegisterEvidenceReceipt(data, request, file.size)) {
            upload.current = null;
            throw createUserFriendlyError('The uploaded agreement could not be confirmed. Upload it again.');
          }
          upload.current.receipt = data;
        }
        const body = {
          appointment: appointment.uuid,
          tokenId: token,
          member: member === 'new' ? memberId : member,
          newMember: member === 'new',
          ...(member === 'new' ? { name: name.trim(), residentialAddress: address.trim() } : {}),
          shares,
          termsOn,
          terms: terms.trim(),
          schedule: schedule.trim(),
          agreementEvidence: upload.current.receipt.uuid,
        };
        command = { request: { operationId: crypto.randomUUID(), ...body }, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
        onHeldChange?.(true);
      }
      if (command.uncertain && !command.confirmed) {
        try {
          check();
          const { data } = await getRegisterAward(apiClient, command.request.operationId, {
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isRecordedRegisterAward(data, command.request, company))
            throw createUserFriendlyError(COPY.RECORDING_FAILED);
          command.confirmed = true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
        }
      }
      if (!command.confirmed) {
        check();
        const { data } = await recordRegisterAward(apiClient, command.request, { ledovaSubmissionGuard: check });
        check();
        if (!isRecordedRegisterAward(data, command.request, company))
          throw createUserFriendlyError(COPY.RECORDING_FAILED);
        command.confirmed = true;
      }
      await onRecorded();
      operation.current = null;
      if (live.current) {
        setHeld(false);
        onHeldChange?.(false);
      }
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) {
            setHeld(false);
            onHeldChange?.(false);
          }
        }
      }
      if (status === 409 && !operation.current) upload.current = null;
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.RECORDING_FAILED, COPY.RECORDING_FAILED));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy || blocked || held} className="space-y-4">
        <label className={LABEL}>
          Promised recipient
          <select className={FIELD_CLASS} value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="new">New recipient</option>
            {members
              .filter((row) => row.walletless && row.particularsRetained)
              .map((row) => (
                <option key={row.member} value={row.member}>
                  {row.name} · {row.member}
                </option>
              ))}
          </select>
        </label>
        {member === 'new' && (
          <>
            <label className={LABEL}>
              Recipient name
              <input
                className={FIELD_CLASS}
                value={name}
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={LABEL}>
              Residential address
              <textarea
                className={FIELD_CLASS}
                value={address}
                maxLength={1000}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
          </>
        )}
        <label className={LABEL}>
          {COPY.SHARES}
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            maxLength={78}
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </label>
        <label className={LABEL}>
          {COPY.TERMS_ON}
          <input
            className={FIELD_CLASS}
            type="date"
            max={today}
            value={termsOn}
            onChange={(event) => setTermsOn(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.TERMS}
          <textarea
            className={FIELD_CLASS}
            maxLength={1000}
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.SCHEDULE}
          <textarea
            className={FIELD_CLASS}
            maxLength={1000}
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.AGREEMENT_DOCUMENT}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={FIELD_CLASS}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="text-sm text-text-muted">PDF or image, max 10 MB. {COPY.NOTE}</p>
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>
      <PageAction
        label={busy ? 'Recording award…' : COPY.SUBMIT}
        disabled={busy || blocked || (!held && !!problem)}
        onClick={() => void submit()}
      />
    </form>
  );
}
