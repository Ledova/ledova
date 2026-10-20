import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_TRANSFER_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterTransfer,
  isRegisterEvidenceReceipt,
  prepareRegisterTransfer,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterTransferPreparation,
  type Person,
  REGISTER_TRANSFER_UNMET_COPY,
  refusalSentence,
} from '@ledova/shared';

import apiClient from '@services/apiClient';
import { transfersKey } from '@pages/company/register/shared/useRegisterTransfers';

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

type DocumentKind = 'authority' | 'instrument';

type Uploaded = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const FAILED = 'The preparation response could not be confirmed. Retry with the same details.';

export type TransferFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onRefused: () => void;
  initialFrom?: string;
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
  initialFrom = '',
}: TransferFormProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [newMemberId] = useState(() => crypto.randomUUID());
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
    toMember: 'new',
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
  const [files, setFiles] = useState<Partial<Record<DocumentKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<DocumentKind, Uploaded>>>({});
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
  const fresh =
    operation?.newParticulars ?? (draft.toMember === 'new' || (!!recipient && !recipient.particularsRetained));
  const problem = !from
    ? 'Select an identified transferor holding shares in this class.'
    : draft.toMember !== 'new' && (!recipient || draft.toMember === draft.fromMember)
      ? 'Select a different recipient.'
      : fresh && (!draft.name.trim() || !draft.residentialAddress.trim())
        ? 'Give the recipient’s name and residential address from the signed instrument.'
        : !/^[1-9]\d*$/.test(draft.shares) || BigInt(draft.shares) > BigInt(from.currentShares)
          ? 'Enter a positive whole share quantity within the transferor’s holding.'
          : !/^\d{4}-\d{2}-\d{2}$/.test(draft.companyEventOn) || draft.companyEventOn > today
            ? 'Enter the company transfer date no later than today (UTC).'
            : ![draft.signedOn, draft.lodgedOn].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today) ||
                draft.signedOn > draft.lodgedOn
              ? 'Enter signing no later than lodgement, and lodgement no later than today (UTC).'
              : !draft.terms.trim() ||
                  !draft.approvingDirector.trim() ||
                  !draft.authorityReference.trim() ||
                  !draft.reason.trim()
                ? 'Give the non-paid terms, approving director, authority reference and reason.'
                : !files.authority || !files.instrument
                  ? 'Choose the director authority and signed transfer instrument.'
                  : null;
  const upload = async (kind: DocumentKind) => {
    const file = files[kind]!;
    const previous = uploads.current[kind];
    const same = previous?.file === file && previous.appointment === appointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : crypto.randomUUID();
    uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: null };
    const request = {
      companyId: company,
      appointment: appointment.uuid,
      kind: kind === 'authority' ? ('authority' as const) : ('supporting' as const),
      idempotencyKey: key,
    };
    check();
    const { data } = await uploadRegisterEvidence(
      apiClient,
      { ...request, file },
      { ledovaSubmissionGuard: check },
    ).catch((failure) => {
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
    if (pending.current || busy || blocked || (!operation && problem)) return;
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
          operationId: crypto.randomUUID(),
          appointment: appointment.uuid,
          tokenId: token,
          fromMember: draft.fromMember,
          toMember: draft.toMember === 'new' ? newMemberId : draft.toMember,
          newMember: draft.toMember === 'new',
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
      const { data } = await prepareRegisterTransfer(apiClient, preparation, { ledovaSubmissionGuard: check });
      check();
      if (!isPreparedRegisterTransfer(data, preparation, newParticulars))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      setOperation(null);
      await client.invalidateQueries({ queryKey: transfersKey(owner, token) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
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
  const fields: [keyof Draft, string, number][] = [
    ['shares', COPY.SHARES, 78],
    ['companyEventOn', COPY.COMPANY_EVENT_ON, 10],
    ['signedOn', COPY.SIGNED_ON, 10],
    ['lodgedOn', COPY.LODGED_ON, 10],
    ['terms', COPY.TERMS, 1000],
    ['approvingDirector', COPY.DIRECTOR, 255],
    ['authorityReference', COPY.AUTHORITY_REFERENCE, 255],
    ['reason', COPY.REASON, 1000],
  ];
  return {
    today,
    draft,
    setFiles,
    busy,
    error,
    operation,
    setOperation,
    change,
    eligible,
    recipient,
    fresh,
    problem,
    submit,
    fields,
  } as const;
}
