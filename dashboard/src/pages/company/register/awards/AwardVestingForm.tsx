import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  REGISTER_AWARD_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterAwardVesting,
  isRecordedRegisterAwardVesting,
  isRegisterEvidenceReceipt,
  recordRegisterAwardVesting,
  uploadRegisterEvidence,
  type OwnCompanyAppointment,
  type RegisterAward,
  type RegisterAwardVestingPreparation,
  type RegisterEvidence,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import apiClient from '@services/apiClient';

export function AwardVestingForm({
  award,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  award: RegisterAward;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
}) {
  const [shares, setShares] = useState('');
  const [vestedOn, setVestedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
  const pending = useRef(false);
  const upload = useRef<{ file: File; key: string; receipt: RegisterEvidence | null } | null>(null);
  const operation = useRef<{ request: RegisterAwardVestingPreparation; confirmed: boolean; uncertain: boolean } | null>(
    null,
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and vesting records before continuing.');
    if (!live.current) throw createUserFriendlyError('This vesting form is closed. Reopen it before continuing.');
  };
  const today = new Date().toISOString().slice(0, 10);
  const problem =
    !/^[1-9]\d*$/.test(shares) || BigInt(shares) > BigInt(award.shares) - BigInt(award.vestedShares)
      ? 'Enter a positive whole quantity within the award’s unvested shares.'
      : !/^\d{4}-\d{2}-\d{2}$/.test(vestedOn) || vestedOn > today
        ? 'Enter a vesting date no later than today (UTC).'
        : !file
          ? 'Choose the company’s evidence for this vesting event.'
          : null;
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && (problem || !file))) return;
    pending.current = true;
    setBusy(true);
    onHeldChange?.(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        if (!canPrepare) throw createUserFriendlyError('Current preparation authority is required to record vesting.');
        if (!file) return;
        if (upload.current?.file !== file) upload.current = { file, key: crypto.randomUUID(), receipt: null };
        const request = {
          companyId: award.company,
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
            throw createUserFriendlyError('The uploaded vesting evidence could not be confirmed. Upload it again.');
          }
          upload.current.receipt = data;
        }
        const body = {
          appointment: appointment.uuid,
          award: award.uuid,
          shares,
          vestedOn,
          evidence: upload.current.receipt.uuid,
        };
        command = { request: { operationId: crypto.randomUUID(), ...body }, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
        onHeldChange?.(true);
      }
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        try {
          check();
          const { data } = await getRegisterAwardVesting(apiClient, command.request.operationId, {
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isRecordedRegisterAwardVesting(data, command.request, award.company))
            throw createUserFriendlyError(COPY.VESTING_FAILED);
          command.confirmed = true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
          absent = true;
        }
      }
      if (!command.confirmed) {
        try {
          check();
          const { data } = await recordRegisterAwardVesting(apiClient, command.request, {
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isRecordedRegisterAwardVesting(data, command.request, award.company))
            throw createUserFriendlyError(COPY.VESTING_FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          check();
          try {
            const { data } = await getRegisterAwardVesting(apiClient, command.request.operationId, {
              ledovaSubmissionGuard: check,
            });
            check();
            if (!isRecordedRegisterAwardVesting(data, command.request, award.company))
              throw createUserFriendlyError(COPY.VESTING_FAILED);
            command.confirmed = true;
          } catch (lookup) {
            check();
            if (failureStatus(lookup) !== 404) throw lookup;
            operation.current = null;
            setHeld(false);
            setError(
              'The original vesting event was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
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
      setError(apiErrorSentence(cause, COPY.VESTING_FAILED, COPY.VESTING_FAILED));
    } finally {
      pending.current = false;
      if (live.current) {
        setBusy(false);
        onHeldChange?.(!!operation.current);
      }
    }
  };
  if (!visible) return null;
  return (
    <form
      className="space-y-5 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-text-muted">
        Record the company-confirmed event for {award.name}; this creates no issued shares.
      </p>
      <fieldset
        disabled={busy || blocked || held || !canPrepare}
        className="grid gap-4 sm:grid-cols-2 [&>p]:sm:col-span-2"
      >
        <label className={LABEL}>
          {COPY.VESTING_SHARES}
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            maxLength={78}
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </label>
        <label className={LABEL}>
          {COPY.VESTED_ON}
          <input
            className={FIELD_CLASS}
            type="date"
            max={today}
            value={vestedOn}
            onChange={(event) => setVestedOn(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.VESTING_DOCUMENT}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={FIELD_CLASS}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="text-sm text-text-muted">{COPY.VESTING_NOTE}</p>
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <div className="flex justify-end border-t border-border-subtle pt-4">
        <PageAction
          primary
          label={busy ? 'Recording vesting…' : COPY.VEST}
          disabled={busy || blocked || (!held && (!canPrepare || !!problem))}
          onClick={() => void submit()}
        />
      </div>
    </form>
  );
}
