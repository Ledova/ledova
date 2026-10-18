import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_OPENING_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterOpening,
  isRegisterEvidenceReceipt,
  isRegisterOpeningHoldingsMoved,
  openingMemberLabels,
  prepareRegisterOpening,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterCorrectionAuthority,
  type RegisterEvidence,
  type RegisterOpeningHolder,
  type RegisterOpeningHolders,
} from '@ledova/shared';

import apiClient from '@services/apiClient';

import { openingsKey } from '@pages/company/register/shared/useRegisterOpenings';

type Draft = {
  file: File | null;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

export const COPY = REGISTER_OPENING_COPY;

const FAILED = 'The opening could not be prepared. Retry with the same details.';

const CLOSED = 'This opening form is closed. Reopen it before continuing.';

const NEW = 'new:';

function problemsOf(draft: Draft) {
  const problems: string[] = [];
  if (!draft.file) problems.push('Choose the authority document.');
  if (draft.authority === 'director_resolution' && !draft.director.trim())
    problems.push('Name the approving director for a resolution.');
  if (!draft.reference.trim() || !draft.reason.trim()) problems.push('Give the authority reference and the reason.');
  return problems;
}

function byAddress(left: { address: string }, right: { address: string }) {
  const [first, second] = [left.address.toLowerCase(), right.address.toLowerCase()];
  return first < second ? -1 : first > second ? 1 : 0;
}

export type OpeningFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  holders: RegisterOpeningHolders;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onReload: () => void;
  onConflict: () => void;
  onMissing: () => void;
};

export function useOpeningPreparation({
  owner,
  guard,
  company,
  token,
  holders,
  appointment,
  blocked,
  onConflict,
  onMissing,
}: Omit<OpeningFormProps, 'onReload'>) {
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
  const [moved, setMoved] = useState(false);
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
  const holdings = holders.holdings;
  const linked = new Map(
    holdings.flatMap(({ member, memberName }) => (member === null ? [] : [[member, memberName] as const])),
  );
  const unlinked = holdings.flatMap(({ address, member }) => (member === null ? [address.toLowerCase()] : []));
  const offered = (value: string) =>
    linked.has(value) || (value.startsWith(NEW) && unlinked.includes(value.slice(NEW.length)));
  const kept = Object.fromEntries(
    Object.entries(choices).filter(([address, value]) => unlinked.includes(address) && offered(value)),
  );
  const reset = Object.keys(kept).length < Object.keys(choices).length;
  const memberOf = (holding: RegisterOpeningHolder) =>
    holding.member ?? kept[holding.address.toLowerCase()] ?? `${NEW}${holding.address.toLowerCase()}`;
  const mapped = holdings.map(memberOf);
  const labels = openingMemberLabels(
    mapped.map((member) => ({ member, memberName: linked.get(member) ?? null, memberExists: linked.has(member) })),
  );
  let fresh = new Set(mapped.filter((member) => member.startsWith(NEW))).size;
  for (const address of unlinked)
    if (!labels.has(`${NEW}${address}`)) labels.set(`${NEW}${address}`, COPY.NEW_MEMBER_NUMBERED(++fresh));
  const problems = problemsOf(draft);
  const clear = () => {
    setError('');
    setMoved(false);
  };
  const update = (patch: Partial<Draft>) => {
    clear();
    setDraft((current) => ({ ...current, ...patch }));
  };
  const choose = (holding: RegisterOpeningHolder, value: string) => {
    clear();
    setChoices({ ...kept, [holding.address.toLowerCase()]: value });
  };

  const mappingOf = () =>
    holdings
      .map((holding) => {
        const member = memberOf(holding);
        if (!member.startsWith(NEW)) return { address: holding.address, member };
        members.current[member] ??= crypto.randomUUID();
        return { address: holding.address, member: members.current[member] };
      })
      .sort(byAddress);

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
    if (pending.current || busy || blocked || problems.length > 0 || !draft.file) return;
    pending.current = true;
    setBusy(true);
    clear();
    setChoices(kept);
    const mapping = mappingOf();
    try {
      check();
      const evidence = await upload(draft.file);
      const request = {
        appointment: appointment.uuid,
        tokenId: token,
        authorityEvidence: evidence.uuid,
        mapping,
        authority: draft.authority,
        approvingDirector: draft.authority === 'director_resolution' ? draft.director.trim() : '',
        authorityReference: draft.reference.trim(),
        reason: draft.reason.trim(),
      };
      const sent = JSON.stringify(request);
      if (operation.current?.signature !== sent) operation.current = { signature: sent, key: crypto.randomUUID() };
      const preparation = { operationId: operation.current.key, ...request };
      try {
        check();
        const { data } = await prepareRegisterOpening(apiClient, preparation, { ledovaSubmissionGuard: check });
        check();
        if (!isPreparedRegisterOpening(data, preparation))
          throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      } catch (failure) {
        if (failureStatus(failure) === 409) {
          operation.current = null;
          onConflict();
        }
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: openingsKey(owner, token) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
        setMoved(isRegisterOpeningHoldingsMoved(failure));
        if (failureStatus(failure) === 404) onMissing();
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return {
    draft,
    busy,
    error,
    moved,
    holdings,
    unlinked,
    reset,
    memberOf,
    labels,
    problems,
    clear,
    update,
    choose,
    submit,
  } as const;
}
