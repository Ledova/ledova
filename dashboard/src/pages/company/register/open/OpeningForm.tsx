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
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { shareCount } from '../proposals';
import { openingsKey } from '../useRegisterOpenings';

type Draft = {
  file: File | null;
  authority: RegisterCorrectionAuthority;
  director: string;
  reference: string;
  reason: string;
};

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const COPY = REGISTER_OPENING_COPY;
const FAILED = 'The opening could not be prepared. Retry with the same details.';
const CLOSED = 'This opening form is closed. Reopen it before continuing.';
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

function byAddress(left: { address: string }, right: { address: string }) {
  const [first, second] = [left.address.toLowerCase(), right.address.toLowerCase()];
  return first < second ? -1 : first > second ? 1 : 0;
}

export function OpeningForm({
  owner,
  guard,
  company,
  token,
  holders,
  appointment,
  blocked,
  onReload,
  onConflict,
  onMissing,
}: {
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
          <legend className="text-sm font-medium text-text-primary">{COPY.HOLDINGS}</legend>
          {holdings.length === 0 && <p className="text-sm text-text-muted">{COPY.NO_HOLDINGS}</p>}
          {unlinked.length > 0 && (
            <p className="text-sm text-text-muted">
              Each address without a linked member is recorded under the member chosen for it. Choose the same member
              for addresses that belong to one person.
            </p>
          )}
          {reset && (
            <p role="status" className="text-sm text-text-primary">
              {COPY.CHOICES_RESET}
            </p>
          )}
          {holdings.map((holding) => (
            <fieldset key={holding.address} className="space-y-2 border-t border-border-subtle pt-3">
              <legend className="break-all text-sm text-text-primary">{holding.address}</legend>
              <p className="text-xs text-text-muted">{shareCount(holding.shares)}</p>
              {holding.member !== null ? (
                <>
                  <p className="text-sm text-text-primary">{labels.get(holding.member)}</p>
                  <p className="text-sm text-text-muted">{COPY.LINKED_NOTE}</p>
                </>
              ) : (
                <label className={LABEL}>
                  {COPY.MEMBER}
                  <select
                    value={memberOf(holding)}
                    className={FIELD_CLASS}
                    onChange={(event) => choose(holding, event.target.value)}
                  >
                    {[...labels].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
      {moved && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-text-muted">{COPY.HOLDINGS_MOVED}</p>
          <PageAction
            label={COPY.RELOAD_HOLDINGS}
            onClick={() => {
              clear();
              onReload();
            }}
          />
        </div>
      )}
      <PageAction
        label={busy ? 'Preparing opening…' : COPY.SUBMIT}
        disabled={busy || blocked || problems.length > 0}
        onClick={() => void submit()}
      />
    </form>
  );
}
