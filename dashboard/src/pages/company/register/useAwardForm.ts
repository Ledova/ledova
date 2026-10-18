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
import apiClient from '@services/apiClient';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useAwardForm({
  company,
  token,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  company: string;
  token: string;
  members: RegisterTransferMember[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
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
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
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
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and award records before continuing.');
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
    onHeldChange?.(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        if (!canPrepare) throw createUserFriendlyError('Current preparation authority is required to record an award.');
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
      let absent = false;
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
          absent = true;
        }
      }
      if (!command.confirmed) {
        try {
          check();
          const { data } = await recordRegisterAward(apiClient, command.request, { ledovaSubmissionGuard: check });
          check();
          if (!isRecordedRegisterAward(data, command.request, company))
            throw createUserFriendlyError(COPY.RECORDING_FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          check();
          try {
            const { data } = await getRegisterAward(apiClient, command.request.operationId, {
              ledovaSubmissionGuard: check,
            });
            check();
            if (!isRecordedRegisterAward(data, command.request, company))
              throw createUserFriendlyError(COPY.RECORDING_FAILED);
            command.confirmed = true;
          } catch (lookup) {
            check();
            if (failureStatus(lookup) !== 404) throw lookup;
            operation.current = null;
            setHeld(false);
            setError(
              'The original award was not recorded and the request was refused. Close this form and start again with current company authority.',
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
      setError(apiErrorSentence(cause, COPY.RECORDING_FAILED, COPY.RECORDING_FAILED));
    } finally {
      pending.current = false;
      if (live.current) {
        setBusy(false);
        onHeldChange?.(!!operation.current);
      }
    }
  };
  return {
    member,
    setMember,
    name,
    setName,
    address,
    setAddress,
    shares,
    setShares,
    termsOn,
    setTermsOn,
    terms,
    setTerms,
    schedule,
    setSchedule,
    setFile,
    busy,
    held,
    error,
    today,
    problem,
    submit,
  };
}
