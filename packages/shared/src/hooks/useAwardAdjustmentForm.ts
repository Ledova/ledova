import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { REGISTER_AWARD_COPY as COPY, REGISTER_AWARD_UNMET_COPY } from '../constants/business/register-awards';
import {
  getRegisterAwardEnd,
  getRegisterAwardVestingReversal,
  recordRegisterAwardEnd,
  recordRegisterAwardVestingReversal,
} from '../services/register-awards';
import { uploadRegisterEvidence } from '../services/register-commands';
import type {
  OwnCompanyAppointment,
  RegisterAward,
  RegisterAwardEndPreparation,
  RegisterAwardVestingReversalPreparation,
  RegisterEvidence,
  RegisterEvidenceFile,
} from '../types';
import { utcToday } from '../utils/date';
import { apiErrorSentence, createUserFriendlyError, failureStatus, refusalSentence } from '../utils/errors';
import { isRecordedRegisterAwardEnd, isRecordedRegisterAwardVestingReversal } from '../utils/register-awards';
import { isRegisterEvidenceReceipt } from '../utils/register-commands';
import { useApiClient } from './useApiClient';
import { hasProblems, type Problems } from './useErrorSummary';
import type { OrderSubmissionSession } from './useSubmissionOwner';

type Command = (
  | { kind: 'end'; request: RegisterAwardEndPreparation }
  | { kind: 'reversal'; request: RegisterAwardVestingReversalPreparation }
) & { confirmed: boolean; uncertain: boolean; evidenceFingerprint: string };

export function useAwardAdjustmentForm({
  award,
  appointment,
  vesting,
  reversibleShares,
  guard,
  blocked,
  visible,
  canPrepare,
  onRecorded,
  onHeldChange,
  newKey,
  session,
}: {
  award: RegisterAward;
  appointment: OwnCompanyAppointment;
  vesting?: string;
  reversibleShares?: string;
  vestingLabel?: string;
  guard: () => void;
  blocked: boolean;
  visible: boolean;
  canPrepare: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  newKey: () => string;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const [unvestedShares, setUnvestedShares] = useState('0');
  const [vestedShares, setVestedShares] = useState('0');
  const [reversedShares, setReversedShares] = useState('');
  const [companyEventOn, setCompanyEventOn] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<RegisterEvidenceFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const unavailable = useRef(blocked || !visible);
  const preparable = useRef(canPrepare);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
    preparable.current = canPrepare;
  }, [blocked, visible, canPrepare]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const pending = useRef(false);
  const upload = useRef<{ file: RegisterEvidenceFile; key: string; receipt: RegisterEvidence | null } | null>(null);
  const operation = useRef<Command | null>(null);
  const check = () => {
    guard();
    if (!live.current || unavailable.current)
      throw createUserFriendlyError('Refresh company access and the current award records before continuing.');
  };
  const beforeWrite = () => {
    check();
    if (!preparable.current) throw createUserFriendlyError('Current preparation authority is required.');
  };
  const config = (current: () => void) => ({ ...session?.requestConfig(), ledovaSubmissionGuard: current });
  const today = utcToday();
  const whole = (value: string) => /^\d+$/.test(value);
  const problems: Problems<
    'reversedShares' | 'unvestedShares' | 'vestedShares' | 'companyEventOn' | 'reason' | 'file'
  > = {
    reversedShares:
      vesting &&
      (!/^[1-9]\d*$/.test(reversedShares) ||
        !reversibleShares ||
        BigInt(reversedShares) > BigInt(reversibleShares) ||
        BigInt(reversedShares) > BigInt(award.availableShares)) &&
      'Enter a positive whole quantity within this vesting’s unreversed shares and the available unissued rights.',
    unvestedShares:
      !vesting &&
      (!whole(unvestedShares) || BigInt(unvestedShares) > BigInt(award.unvestedRemainingShares)
        ? 'Enter a whole quantity within the award’s unvested shares.'
        : whole(vestedShares) &&
          BigInt(unvestedShares) + BigInt(vestedShares) === 0n &&
          'Choose unvested or vested unissued quantities within the remaining entitlement.'),
    vestedShares:
      !vesting &&
      (!whole(vestedShares) || BigInt(vestedShares) > BigInt(award.availableShares)) &&
      'Enter a whole quantity within the award’s vested unissued shares.',
    companyEventOn:
      (!/^\d{4}-\d{2}-\d{2}$/.test(companyEventOn) || companyEventOn > today) &&
      'Enter a company event date no later than today (UTC).',
    reason: !reason.trim() && 'Enter the company’s reason.',
    file: !file && 'Choose the company’s supporting evidence.',
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && hasProblems(problems))) return;
    pending.current = true;
    setBusy(true);
    onHeldChange(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        beforeWrite();
        if (!file) return;
        const captured = {
          unvestedShares,
          vestedShares,
          reversedShares,
          companyEventOn,
          reason: reason.trim(),
          vesting,
        };
        if (upload.current?.file !== file) upload.current = { file, key: newKey(), receipt: null };
        const request = {
          companyId: award.company,
          appointment: appointment.uuid,
          kind: 'supporting' as const,
          idempotencyKey: upload.current.key,
        };
        if (!upload.current.receipt) {
          const { data } = await uploadRegisterEvidence(apiClient, { ...request, file }, config(beforeWrite));
          beforeWrite();
          if (!isRegisterEvidenceReceipt(data, request, file.size)) {
            upload.current = null;
            throw createUserFriendlyError('The uploaded evidence could not be confirmed. Upload it again.');
          }
          upload.current.receipt = data;
        }
        const common = {
          operationId: newKey(),
          appointment: appointment.uuid,
          companyEventOn: captured.companyEventOn,
          reason: captured.reason,
          evidence: upload.current.receipt.uuid,
        };
        command = captured.vesting
          ? {
              kind: 'reversal',
              request: { ...common, vesting: captured.vesting, reversedShares: captured.reversedShares },
              confirmed: false,
              uncertain: false,
              evidenceFingerprint: upload.current.receipt.sha256,
            }
          : {
              kind: 'end',
              request: {
                ...common,
                award: award.uuid,
                unvestedShares: captured.unvestedShares,
                vestedShares: captured.vestedShares,
              },
              confirmed: false,
              uncertain: false,
              evidenceFingerprint: upload.current.receipt.sha256,
            };
        operation.current = command;
        setHeld(true);
      }
      const lookup = async () => {
        try {
          check();
          const valid =
            command.kind === 'end'
              ? isRecordedRegisterAwardEnd(
                  (await getRegisterAwardEnd(apiClient, command.request.operationId, config(check))).data,
                  command.request,
                  award.company,
                  command.evidenceFingerprint,
                )
              : isRecordedRegisterAwardVestingReversal(
                  (await getRegisterAwardVestingReversal(apiClient, command.request.operationId, config(check))).data,
                  command.request,
                  award.company,
                  award.uuid,
                  command.evidenceFingerprint,
                );
          check();
          if (!valid) throw createUserFriendlyError(COPY.ADJUSTMENT_FAILED);
          return true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
          return false;
        }
      };
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        command.confirmed = await lookup();
        absent = !command.confirmed;
      }
      if (!command.confirmed) {
        try {
          const writeGuard = command.uncertain ? check : beforeWrite;
          writeGuard();
          const valid =
            command.kind === 'end'
              ? isRecordedRegisterAwardEnd(
                  (await recordRegisterAwardEnd(apiClient, command.request, config(writeGuard))).data,
                  command.request,
                  award.company,
                  command.evidenceFingerprint,
                )
              : isRecordedRegisterAwardVestingReversal(
                  (await recordRegisterAwardVestingReversal(apiClient, command.request, config(writeGuard))).data,
                  command.request,
                  award.company,
                  award.uuid,
                  command.evidenceFingerprint,
                );
          check();
          if (!valid) throw createUserFriendlyError(COPY.ADJUSTMENT_FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          command.confirmed = await lookup();
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            setError(
              'The original change was not recorded and was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await onRecorded();
      operation.current = null;
      if (live.current) {
        setHeld(false);
        onHeldChange(false);
      }
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) setHeld(false);
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(
        refusalSentence(cause, REGISTER_AWARD_UNMET_COPY) ??
          apiErrorSentence(cause, COPY.ADJUSTMENT_FAILED, COPY.ADJUSTMENT_FAILED),
      );
    } finally {
      pending.current = false;
      if (live.current) {
        setBusy(false);
        onHeldChange(!!operation.current);
      }
    }
  };
  return {
    unvestedShares,
    setUnvestedShares,
    vestedShares,
    setVestedShares,
    reversedShares,
    setReversedShares,
    companyEventOn,
    setCompanyEventOn,
    reason,
    setReason,
    setFile,
    busy,
    held,
    error,
    today,
    problems,
    submit,
  };
}
