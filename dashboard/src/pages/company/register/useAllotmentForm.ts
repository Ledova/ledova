import {
  REGISTER_ALLOTMENT_COPY as COPY,
  allotmentAud,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterAllotment,
  isPreparedRegisterAllotment,
  isRegisterEvidenceReceipt,
  prepareRegisterAllotment,
  uploadRegisterEvidence,
  type OwnCompanyAppointment,
  type RegisterAllotmentPreparation,
  type RegisterEvidence,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useEffect, useRef, useState } from 'react';
import { personRequest, type Person } from '@pages/company/register/shared/usePeople';
export type DocumentKind = 'authority' | 'agreement' | 'receipt';
export function useAllotmentForm({
  company,
  token,
  people,
  initialMember,
  appointment,
  guard,
  newEffectGuard,
  blocked,
  onRecorded,
  onHeldChange,
}: {
  company: string;
  token: string;
  people: Person[];
  initialMember?: string;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  newEffectGuard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  visible?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [memberId] = useState(() => crypto.randomUUID());
  const [member, setMember] = useState(() =>
    people.some((person) => person.member === initialMember && person.walletless && person.particularsRetained)
      ? initialMember!
      : 'new',
  );
  const [fields, setFields] = useState({
    name: '',
    residentialAddress: '',
    shares: '',
    companyEventOn: '',
    consideration: '',
    receivedAmount: '',
    agreementReference: '',
    agreementOn: today,
    receivedOn: today,
    terms: '',
    approvingDirector: '',
    authorityReference: '',
    reason: '',
  });
  const [files, setFiles] = useState<Partial<Record<DocumentKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<DocumentKind, { file: File; key: string; receipt: RegisterEvidence | null }>>>(
    {},
  );
  const operation = useRef<{ request: RegisterAllotmentPreparation; confirmed: boolean; uncertain: boolean } | null>(
    null,
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    onHeldChange(busy || held);
    return () => onHeldChange(false);
  }, [busy, held, onHeldChange]);
  const check = () => {
    guard();
    if (!live.current) throw createUserFriendlyError('This allotment form is closed.');
  };
  const beforeWrite = () => {
    check();
    newEffectGuard();
  };
  const consideration = allotmentAud(fields.consideration);
  const received = allotmentAud(fields.receivedAmount);
  const problem =
    member === 'new' && (!fields.name.trim() || !fields.residentialAddress.trim())
      ? 'Give the new person’s name and residential address.'
      : !/^[1-9]\d*$/.test(fields.shares) || BigInt(fields.shares) >= 2n ** 256n
        ? 'Enter a positive whole number of shares.'
        : !consideration || received !== consideration
          ? 'The company-reported receipt must equal the full positive AUD consideration, with at most two decimal places.'
          : !/^\d{4}-\d{2}-\d{2}$/.test(fields.companyEventOn) || fields.companyEventOn > today
            ? 'Enter the company issue date no later than today (UTC).'
            : [fields.agreementOn, fields.receivedOn].some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)
              ? 'Agreement and receipt dates must be today (UTC) or earlier.'
              : !fields.agreementReference.trim() ||
                  !fields.terms.trim() ||
                  !fields.approvingDirector.trim() ||
                  !fields.authorityReference.trim() ||
                  !fields.reason.trim()
                ? 'Give the external agreement, approving director, company authority and reason.'
                : (['authority', 'agreement', 'receipt'] as const).some((kind) => !files[kind])
                  ? 'Choose the authority, agreement and receipt evidence.'
                  : null;
  const upload = async (kind: DocumentKind) => {
    const file = files[kind]!;
    if (uploads.current[kind]?.file !== file) uploads.current[kind] = { file, key: crypto.randomUUID(), receipt: null };
    const saved = uploads.current[kind]!;
    if (!saved.receipt) {
      const request = {
        companyId: company,
        appointment: appointment.uuid,
        kind: kind === 'authority' ? ('authority' as const) : ('supporting' as const),
        idempotencyKey: saved.key,
      };
      beforeWrite();
      const { data } = await uploadRegisterEvidence(
        apiClient,
        { ...request, file },
        { ledovaSubmissionGuard: beforeWrite },
      );
      check();
      if (!isRegisterEvidenceReceipt(data, request, file.size)) {
        delete uploads.current[kind];
        throw createUserFriendlyError('The uploaded evidence could not be confirmed.');
      }
      saved.receipt = data;
    }
    return saved.receipt;
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && problem)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        const authority = await upload('authority');
        const agreement = await upload('agreement');
        const receipt = await upload('receipt');
        command = {
          request: {
            operationId: crypto.randomUUID(),
            appointment: appointment.uuid,
            tokenId: token,
            ...personRequest(member, people, memberId, fields.name, fields.residentialAddress),
            shares: fields.shares,
            companyEventOn: fields.companyEventOn,
            consideration: consideration!,
            receivedAmount: received!,
            currency: 'AUD',
            agreementReference: fields.agreementReference.trim(),
            agreementOn: fields.agreementOn,
            terms: fields.terms.trim(),
            receivedOn: fields.receivedOn,
            approvingDirector: fields.approvingDirector.trim(),
            authorityReference: fields.authorityReference.trim(),
            reason: fields.reason.trim(),
            authorityEvidence: authority.uuid,
            agreementEvidence: agreement.uuid,
            receiptEvidence: receipt.uuid,
          },
          confirmed: false,
          uncertain: false,
        };
        operation.current = command;
        setHeld(true);
      }
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        try {
          check();
          const { data } = await getRegisterAllotment(apiClient, command.request.operationId, {
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isPreparedRegisterAllotment(data, command.request, company))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
          absent = true;
        }
      }
      if (!command.confirmed) {
        const dispatchGuard = command.uncertain ? check : beforeWrite;
        try {
          dispatchGuard();
          const { data } = await prepareRegisterAllotment(apiClient, command.request, {
            ledovaSubmissionGuard: dispatchGuard,
          });
          check();
          if (!isPreparedRegisterAllotment(data, command.request, company))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          check();
          try {
            const { data } = await getRegisterAllotment(apiClient, command.request.operationId, {
              ledovaSubmissionGuard: check,
            });
            check();
            if (!isPreparedRegisterAllotment(data, command.request, company))
              throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
            command.confirmed = true;
          } catch (lookup) {
            check();
            if (failureStatus(lookup) !== 404) throw lookup;
            operation.current = null;
            setHeld(false);
            setError(
              'The original allotment was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await onRecorded();
      operation.current = null;
      if (live.current) {
        setHeld(false);
      }
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) {
            setHeld(false);
          }
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.PREPARATION_RECEIPT_FAILED, COPY.PREPARATION_RECEIPT_FAILED));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  return {
    today,
    member,
    setMember,
    fields,
    setFields,
    setFiles,
    busy,
    held,
    error,
    problem,
    submit,
  };
}
