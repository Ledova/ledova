import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REGISTER_TRANSFER_COPY as COPY, REGISTER_TRANSFER_UNMET_COPY } from '../constants/business/register-transfers';
import { uploadRegisterEvidence } from '../services/register-commands';
import { prepareRegisterTransfer } from '../services/register-transfers';
import type {
  OwnCompanyAppointment,
  RegisterDocumentFile,
  RegisterEvidence,
  RegisterTransferPreparation,
} from '../types';
import { utcToday } from '../utils/date';
import { apiErrorSentence, createUserFriendlyError, failureStatus, refusalSentence } from '../utils/errors';
import type { Person } from '../utils/people';
import { isRegisterEvidenceReceipt } from '../utils/register-commands';
import { isPreparedRegisterTransfer } from '../utils/register-transfers';
import { useApiClient } from './useApiClient';
import { hasProblems, type Problems } from './useErrorSummary';
import { transfersKey } from './useRegisterTransfers';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

type Draft = {
  fromMember: string;
  toMember: string;
  name: string;
  residentialAddress: string;
  shares: string;
  companyEventOn: string;
  signedOn: string;
  lodgedOn: string;
  terms: string;
  approvingDirector: string;
  authorityReference: string;
  reason: string;
};

export type TransferDocumentKind = 'authority' | 'instrument';

type Uploaded = { file: RegisterDocumentFile; appointment: string; key: string; receipt: RegisterEvidence | null };

const FAILED = 'The preparation response could not be confirmed. Retry with the same details.';

export type TransferPreparationOptions = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onRefused: () => void;
  onPrepared: (uuid: string) => void;
  initialFrom?: string;
  newKey: () => string;
  session?: OrderSubmissionSession;
};

export function useTransferPreparation({
  owner,
  guard,
  company,
  token,
  people,
  appointment,
  blocked,
  onRefused,
  onPrepared,
  initialFrom = '',
  newKey,
  session,
}: TransferPreparationOptions) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const today = utcToday();
  const [draft, setDraft] = useState<Draft>({
    fromMember: people.some(
      (person) =>
        person.member === initialFrom &&
        person.walletless &&
        person.particularsRetained &&
        BigInt(person.currentShares) > 0n,
    )
      ? initialFrom
      : '',
    toMember: '',
    name: '',
    residentialAddress: '',
    shares: '',
    companyEventOn: '',
    signedOn: today,
    lodgedOn: today,
    terms: '',
    approvingDirector: '',
    authorityReference: '',
    reason: '',
  });
  const [files, setFiles] = useState<Partial<Record<TransferDocumentKind, RegisterDocumentFile>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<TransferDocumentKind, Uploaded>>>({});
  const [operation, setOperation] = useState<{ request: RegisterTransferPreparation; newParticulars: boolean } | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw createUserFriendlyError('This transfer form is closed. Reopen it before continuing.');
  };
  const config = () => ({ ...session?.requestConfig(), ledovaSubmissionGuard: check });
  const change = (key: keyof Draft, value: string) => {
    setOperation(null);
    setError('');
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const eligible = people.filter((member) => member.walletless);
  const from = eligible.find(
    (member) => member.member === draft.fromMember && member.particularsRetained && BigInt(member.currentShares) > 0n,
  );
  const recipient = eligible.find((member) => member.member === draft.toMember);
  const fresh = operation?.newParticulars ?? (!!recipient && !recipient.particularsRetained);
  const past = (date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today;
  const problems: Problems<keyof Draft | 'authorityDocument' | 'instrumentDocument'> = {
    fromMember: !from && 'Select an identified transferor holding shares in this class.',
    toMember: (!recipient || draft.toMember === draft.fromMember) && 'Select a different existing company person.',
    name: fresh && !draft.name.trim() && 'Give the recipient’s name from the signed instrument.',
    residentialAddress:
      fresh &&
      !draft.residentialAddress.trim() &&
      'Give the recipient’s residential address from the signed instrument.',
    shares:
      (!/^[1-9]\d*$/.test(draft.shares) || (!!from && BigInt(draft.shares) > BigInt(from.currentShares))) &&
      'Enter a positive whole share quantity within the transferor’s holding.',
    companyEventOn: past(draft.companyEventOn) && 'Enter the company transfer date no later than today (UTC).',
    signedOn: past(draft.signedOn) && 'Enter a signing date no later than today (UTC).',
    lodgedOn: past(draft.lodgedOn)
      ? 'Enter a lodgement date no later than today (UTC).'
      : !past(draft.signedOn) &&
        draft.signedOn > draft.lodgedOn &&
        'Enter a lodgement date on or after the signing date.',
    terms: !draft.terms.trim() && 'Give the non-paid terms.',
    approvingDirector: !draft.approvingDirector.trim() && 'Name the approving director.',
    authorityReference: !draft.authorityReference.trim() && 'Give the authority reference.',
    reason: !draft.reason.trim() && 'Give the reason.',
    authorityDocument: !files.authority && 'Choose the director authority.',
    instrumentDocument: !files.instrument && 'Choose the signed transfer instrument.',
  };
  const upload = async (kind: TransferDocumentKind) => {
    const file = files[kind]!;
    const previous = uploads.current[kind];
    const same = previous?.file === file && previous.appointment === appointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : newKey();
    uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: null };
    const request = {
      companyId: company,
      appointment: appointment.uuid,
      kind: kind === 'authority' ? ('authority' as const) : ('supporting' as const),
      idempotencyKey: key,
    };
    check();
    const { data } = await uploadRegisterEvidence(apiClient, { ...request, file }, config()).catch((failure) => {
      if (failureStatus(failure) === 409) delete uploads.current[kind];
      throw failure;
    });
    check();
    if (!isRegisterEvidenceReceipt(data, request, file.size)) {
      delete uploads.current[kind];
      throw createUserFriendlyError('The uploaded document could not be confirmed. Upload it again.');
    }
    uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: data };
    return data;
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation && hasProblems(problems))) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      let retained = operation;
      if (!retained) {
        const authority = await upload('authority');
        const instrument = await upload('instrument');
        const request: RegisterTransferPreparation = {
          operationId: newKey(),
          appointment: appointment.uuid,
          tokenId: token,
          fromMember: draft.fromMember,
          toMember: draft.toMember,
          newMember: false,
          ...(fresh ? { name: draft.name.trim(), residentialAddress: draft.residentialAddress.trim() } : {}),
          shares: draft.shares,
          companyEventOn: draft.companyEventOn,
          signedOn: draft.signedOn,
          lodgedOn: draft.lodgedOn,
          terms: draft.terms.trim(),
          approvingDirector: draft.approvingDirector.trim(),
          authorityReference: draft.authorityReference.trim(),
          reason: draft.reason.trim(),
          authorityEvidence: authority.uuid,
          instrumentEvidence: instrument.uuid,
        };
        retained = { request, newParticulars: fresh };
        setOperation(retained);
      }
      const { request: preparation, newParticulars } = retained;
      check();
      const { data } = await prepareRegisterTransfer(apiClient, preparation, config());
      check();
      if (!isPreparedRegisterTransfer(data, preparation, newParticulars))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      setOperation(null);
      await client.invalidateQueries({ queryKey: transfersKey(owner, token) });
      check();
      onPrepared(data.uuid);
    } catch (failure) {
      const status = failureStatus(failure);
      if (status && status < 500) setOperation(null);
      try {
        check();
      } catch {
        return;
      }
      setError(refusalSentence(failure, REGISTER_TRANSFER_UNMET_COPY) ?? apiErrorSentence(failure, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) onRefused();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return {
    today,
    draft,
    files,
    setFiles,
    busy,
    error,
    operation,
    setOperation,
    change,
    eligible,
    from,
    recipient,
    fresh,
    problems,
    submit,
  } as const;
}
