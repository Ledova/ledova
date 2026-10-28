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
  REGISTER_AWARD_UNMET_COPY,
  refusalSentence,
  utcToday,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useAwardVestingForm({
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
  const [vestedOn, setVestedOn] = useState(utcToday);
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
  const today = utcToday();
  const problems: Problems<'shares' | 'vestedOn' | 'file'> = {
    shares:
      (!/^[1-9]\d*$/.test(shares) || BigInt(shares) > BigInt(award.unvestedRemainingShares)) &&
      'Enter a positive whole quantity within the award’s unvested shares.',
    vestedOn:
      (!/^\d{4}-\d{2}-\d{2}$/.test(vestedOn) || vestedOn > today) && 'Enter a vesting date no later than today (UTC).',
    file: !file && 'Choose the company’s evidence for this vesting event.',
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && (hasProblems(problems) || !file))) return;
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
      setError(
        refusalSentence(cause, REGISTER_AWARD_UNMET_COPY) ??
          apiErrorSentence(cause, COPY.VESTING_FAILED, COPY.VESTING_FAILED),
      );
    } finally {
      pending.current = false;
      if (live.current) {
        setBusy(false);
        onHeldChange?.(!!operation.current);
      }
    }
  };
  return { shares, setShares, vestedOn, setVestedOn, setFile, busy, held, error, today, problems, submit };
}
