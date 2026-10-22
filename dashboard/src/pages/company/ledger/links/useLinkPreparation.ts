import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  REGISTER_LINK_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterLink,
  isRegisterEvidenceReceipt,
  prepareRegisterLink,
  registerLinkMemberLabels,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterCorrectionAuthority,
  type RegisterEvidence,
  type RegisterWaitingWallets,
  type TokenHoldersResponse,
} from '@ledova/shared';

import apiClient from '@services/apiClient';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';

import { linksKey } from '@pages/company/ledger/shared/useRegisterLinks';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

type Draft = {
  file: File | null;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

export const COPY = REGISTER_LINK_COPY;

const FAILED = 'The wallet link could not be prepared. Retry with the same details.';

const CLOSED = 'This wallet link form is closed. Reopen it before continuing.';

const NEW = 'new:';

function problemsOf(draft: Draft): Problems<'file' | 'director' | 'reference' | 'reason'> {
  return {
    file: !draft.file && 'Choose the authority document.',
    director:
      draft.authority === 'director_resolution' &&
      !draft.director.trim() &&
      'Name the approving director for a resolution.',
    reference: !draft.reference.trim() && 'Give the authority reference.',
    reason: !draft.reason.trim() && 'Give the reason.',
  };
}

function inRecordedOrder(left: { address: string }, right: { address: string }) {
  return left.address < right.address ? -1 : left.address > right.address ? 1 : 0;
}

export type LinkFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  wallets: RegisterWaitingWallets['wallets'];
  registers: TokenHoldersResponse[];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onRefused: () => void;
  onConflict: () => void;
  onMissing: () => void;
};

export function useLinkPreparation({
  owner,
  guard,
  company,
  wallets,
  registers,
  appointment,
  blocked,
  onRefused,
  onConflict,
  onMissing,
}: LinkFormProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>({
    file: null,
    authority: 'director_resolution',
    director: '',
    reference: '',
    reason: '',
  });
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploaded = useRef<Upload | null>(null);
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const members = useRef<Record<string, string>>({});
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
  const holders = registers.flatMap((register) => register.holders);
  const existing = new Set(holders.map(({ member }) => member));
  const ordered = [...wallets].sort(inRecordedOrder);
  const addresses = ordered.map(({ address }) => address.toLowerCase());
  const offered = (value: string) =>
    existing.has(value) || (value.startsWith(NEW) && addresses.includes(value.slice(NEW.length)));
  const kept = Object.fromEntries(
    Object.entries(choices).filter(([address, value]) => addresses.includes(address) && offered(value)),
  );
  const reset = Object.keys(kept).length < Object.keys(choices).length;
  const memberOf = (address: string) => kept[address] ?? `${NEW}${address}`;
  const labels = registerLinkMemberLabels(
    [...addresses.map(memberOf), ...addresses.map((address) => `${NEW}${address}`)].map((member) => ({
      member,
      memberExists: existing.has(member),
    })),
    holders,
  );
  const problems = problemsOf(draft);
  const update = (patch: Partial<Draft>) => {
    setError('');
    setDraft((current) => ({ ...current, ...patch }));
  };
  const choose = (address: string, value: string) => {
    setError('');
    setChoices({ ...kept, [address]: value });
  };

  const mappingOf = () =>
    ordered.map(({ address }) => {
      const member = memberOf(address.toLowerCase());
      if (!member.startsWith(NEW)) return { address, member };
      members.current[member] ??= crypto.randomUUID();
      return { address, member: members.current[member] };
    });

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
    if (pending.current || busy || blocked || hasProblems(problems) || !draft.file) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setChoices(kept);
    const mapping = mappingOf();
    try {
      check();
      const evidence = await upload(draft.file);
      const request = {
        appointment: appointment.uuid,
        companyId: company,
        authorityEvidence: evidence.uuid,
        mapping,
        authority: draft.authority,
        approvingDirector: draft.authority === 'director_resolution' ? draft.director.trim() : '',
        authorityReference: draft.reference.trim(),
        reason: draft.reason.trim(),
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      const preparation = { operationId: operation.current.key, ...request };
      let prepared = '';
      try {
        check();
        const { data } = await prepareRegisterLink(apiClient, preparation, { ledovaSubmissionGuard: check });
        check();
        if (!isPreparedRegisterLink(data, preparation)) throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
        prepared = data.uuid;
      } catch (failure) {
        if (failureStatus(failure) === 409) operation.current = null;
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: linksKey(owner, company) });
      check();
      const place = registerPlace({ company, task: 'corrections', record: prepared, outcome: 'Wallet link prepared.' });
      navigate(place.to, { state: place.state });
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
        if (failureStatus(failure) === 400) onRefused();
        if (failureStatus(failure) === 409) onConflict();
        if (failureStatus(failure) === 404) onMissing();
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { draft, busy, error, ordered, reset, memberOf, labels, problems, update, choose, submit } as const;
}
