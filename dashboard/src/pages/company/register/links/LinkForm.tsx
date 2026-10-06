import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_LINK_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterLink,
  isRegisterEvidenceReceipt,
  openingMemberLabels,
  prepareRegisterLink,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterCorrectionAuthority,
  type RegisterEvidence,
  type RegisterWaitingWallets,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { WalletStatus } from '../WalletStatus';
import { registerMembers } from '../proposals';
import { linksKey } from '../useRegisterLinks';

type Draft = {
  file: File | null;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const COPY = REGISTER_LINK_COPY;
const FAILED = 'The wallet link could not be prepared. Retry with the same details.';
const CLOSED = 'This wallet link form is closed. Reopen it before continuing.';
const LABEL = 'block space-y-1 text-sm text-text-primary';
const EVIDENCE = 'application/pdf,image/png,image/jpeg';
const NEW = 'new:';
const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

function problemsOf(draft: Draft) {
  const problems: string[] = [];
  if (!draft.file) problems.push('Choose the authority document.');
  if (draft.authority === 'director_resolution' && !draft.director.trim())
    problems.push('Name the approving director for a resolution.');
  if (!draft.reference.trim() || !draft.reason.trim()) problems.push('Give the authority reference and the reason.');
  return problems;
}

export function LinkForm({
  owner,
  guard,
  company,
  wallets,
  registers,
  appointment,
  blocked,
  onConflict,
  onMissing,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  wallets: RegisterWaitingWallets['wallets'];
  registers: TokenHoldersResponse[];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
  onMissing: () => void;
}) {
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
  const existing = registerMembers(registers);
  const addresses = wallets.map(({ address }) => address.toLowerCase());
  const offered = (value: string) =>
    existing.has(value) || (value.startsWith(NEW) && addresses.includes(value.slice(NEW.length)));
  const kept = Object.fromEntries(
    Object.entries(choices).filter(([address, value]) => addresses.includes(address) && offered(value)),
  );
  const reset = Object.keys(kept).length < Object.keys(choices).length;
  const memberOf = (address: string) => kept[address] ?? `${NEW}${address}`;
  const fresh = [...addresses.map(memberOf), ...addresses.map((address) => `${NEW}${address}`)].filter((member) =>
    member.startsWith(NEW),
  );
  const labels = openingMemberLabels([
    ...[...existing].map(([member, memberName]) => ({ member, memberName, memberExists: true })),
    ...fresh.map((member) => ({ member, memberName: null, memberExists: false })),
  ]);
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
    wallets.map(({ address }) => {
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
    if (pending.current || busy || blocked || problems.length > 0 || !draft.file) return;
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
      try {
        check();
        const { data } = await prepareRegisterLink(apiClient, preparation, { ledovaSubmissionGuard: check });
        check();
        if (!isPreparedRegisterLink(data, preparation)) throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      } catch (failure) {
        if (failureStatus(failure) === 409) operation.current = null;
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: linksKey(owner, company) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
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

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Evidence provided by the company</legend>
          <label className={LABEL}>
            {COPY.AUTHORITY_DOCUMENT}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => update({ file: event.target.files?.[0] ?? null })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.AUTHORITY_DOCUMENT_NOTE}</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Authority and reason</legend>
          <label className={LABEL}>
            {COPY.AUTHORITY}
            <select
              value={draft.authority}
              className={FIELD_CLASS}
              onChange={(event) => update({ authority: event.target.value as RegisterCorrectionAuthority })}
            >
              {AUTHORITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {draft.authority === 'director_resolution' && (
            <label className={LABEL}>
              {COPY.APPROVING_DIRECTOR}
              <input
                value={draft.director}
                maxLength={255}
                className={FIELD_CLASS}
                onChange={(event) => update({ director: event.target.value })}
              />
            </label>
          )}
          <label className={LABEL}>
            {COPY.AUTHORITY_REFERENCE}
            <input
              value={draft.reference}
              maxLength={255}
              className={FIELD_CLASS}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.REASON}
            <textarea
              rows={3}
              value={draft.reason}
              maxLength={1000}
              className={FIELD_CLASS}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </label>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">{COPY.WALLETS}</legend>
          <p className="text-sm text-text-muted">{COPY.MAPPING_NOTE}</p>
          <p className="text-sm text-text-muted">{COPY.STATUS_NOTE}</p>
          {reset && (
            <p role="status" className="text-sm text-text-primary">
              {COPY.CHOICES_RESET}
            </p>
          )}
          {wallets.map((wallet) => (
            <fieldset key={wallet.address} className="space-y-2 border-t border-border-subtle pt-3">
              <legend className="break-all text-sm text-text-primary">{wallet.address}</legend>
              <p className="text-xs text-text-muted">{COPY.WAITING(wallet.waiting)}</p>
              <WalletStatus wallet={wallet} />
              <label className={LABEL}>
                {COPY.MEMBER}
                <select
                  value={memberOf(wallet.address.toLowerCase())}
                  className={FIELD_CLASS}
                  onChange={(event) => choose(wallet.address.toLowerCase(), event.target.value)}
                >
                  {[...labels].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ))}
        </fieldset>
      </fieldset>
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <PageAction
        label={busy ? 'Preparing wallet link…' : COPY.SUBMIT}
        disabled={busy || blocked || problems.length > 0}
        onClick={() => void submit()}
      />
    </form>
  );
}
