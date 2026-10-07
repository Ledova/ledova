import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_GRANT_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  isPreparedRegisterGrant,
  isRegisterEvidenceReceipt,
  prepareRegisterGrant,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterGrantPreparation,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { grantsKey } from '../useRegisterGrants';

type DocumentKind = 'authority' | 'terms' | 'acceptance';
type Uploaded = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };
const LABEL = 'block space-y-1 text-sm text-text-primary';
const FAILED = 'The grant preparation response could not be confirmed. Retry with the same details.';
const DOCUMENTS: Record<DocumentKind, string> = {
  authority: COPY.AUTHORITY_DOCUMENT,
  terms: COPY.TERMS_DOCUMENT,
  acceptance: COPY.ACCEPTANCE_DOCUMENT,
};

export function GrantForm({
  owner,
  guard,
  company,
  token,
  members,
  appointment,
  blocked,
  onRefused,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  members: TokenHoldersResponse['holders'];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onRefused: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [newMemberId] = useState(() => crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(today);
  const [approvingDirector, setApprovingDirector] = useState('');
  const [terms, setTerms] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState(false);
  const [files, setFiles] = useState<Partial<Record<DocumentKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<DocumentKind, Uploaded>>>({});
  const operation = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw createUserFriendlyError('This grant form is closed. Reopen it before continuing.');
  };
  const documentKinds: DocumentKind[] = acceptanceRequired
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  const problem =
    member === 'new' && (!name.trim() || !address.trim())
      ? 'Give the new member’s name and residential address.'
      : !/^[1-9]\d*$/.test(shares)
        ? 'Enter a positive whole number of shares.'
        : !/^\d{4}-\d{2}-\d{2}$/.test(termsOn) || termsOn > today
          ? 'Enter a terms date no later than today (UTC).'
          : !terms.trim() || !approvingDirector.trim() || !authorityReference.trim() || !reason.trim()
            ? 'Give the non-paid terms, approving director, authority reference and reason.'
            : documentKinds.some((kind) => !files[kind])
              ? 'Choose the authority, terms and any required acceptance documents.'
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
    if (pending.current || busy || blocked || problem) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      const authority = await upload('authority');
      const retainedTerms = await upload('terms');
      const acceptance = acceptanceRequired ? await upload('acceptance') : null;
      const request = {
        appointment: appointment.uuid,
        tokenId: token,
        member: member === 'new' ? newMemberId : member,
        newMember: member === 'new',
        ...(member === 'new' ? { name: name.trim(), residentialAddress: address.trim() } : {}),
        shares,
        termsOn,
        terms: terms.trim(),
        approvingDirector: approvingDirector.trim(),
        authorityReference: authorityReference.trim(),
        reason: reason.trim(),
        authorityEvidence: authority.uuid,
        termsEvidence: retainedTerms.uuid,
        acceptanceRequired,
        acceptanceEvidence: acceptance?.uuid ?? null,
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      const preparation: RegisterGrantPreparation = { operationId: operation.current.key, ...request };
      check();
      const { data } = await prepareRegisterGrant(apiClient, preparation, { ledovaSubmissionGuard: check });
      check();
      if (!isPreparedRegisterGrant(data, preparation)) throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      operation.current = null;
      await client.invalidateQueries({ queryKey: grantsKey(owner, token) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
    } catch (failure) {
      const status = failureStatus(failure);
      if (status && status < 500) operation.current = null;
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(failure, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) onRefused();
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
      <fieldset disabled={busy || blocked} className="space-y-4">
        <label className={LABEL}>
          Member
          <select className={FIELD_CLASS} value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="new">New member</option>
            {members.map((holder) => (
              <option key={holder.member} value={holder.member}>
                {holder.name || 'Unnamed member'} · {holder.member}
              </option>
            ))}
          </select>
        </label>
        {member === 'new' ? (
          <>
            <label className={LABEL}>
              {COPY.NAME}
              <input
                className={FIELD_CLASS}
                value={name}
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={LABEL}>
              {COPY.RESIDENTIAL_ADDRESS}
              <input
                className={FIELD_CLASS}
                value={address}
                maxLength={1000}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
          </>
        ) : (
          <p className="text-sm text-text-muted">
            The grant retains the existing member’s current particulars. Preview them before approval.
          </p>
        )}
        <label className={LABEL}>
          {COPY.SHARES}
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </label>
        <label className={LABEL}>
          {COPY.TERMS_ON}
          <input
            type="date"
            max={today}
            className={FIELD_CLASS}
            value={termsOn}
            onChange={(event) => setTermsOn(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.TERMS}
          <textarea
            className={FIELD_CLASS}
            maxLength={1000}
            rows={3}
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.DIRECTOR}
          <input
            className={FIELD_CLASS}
            maxLength={255}
            value={approvingDirector}
            onChange={(event) => setApprovingDirector(event.target.value)}
          />
        </label>
        <p className="text-sm text-text-muted">
          {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </p>
        <label className={LABEL}>
          {COPY.AUTHORITY_REFERENCE}
          <input
            className={FIELD_CLASS}
            maxLength={255}
            value={authorityReference}
            onChange={(event) => setAuthorityReference(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.REASON}
          <textarea
            className={FIELD_CLASS}
            maxLength={1000}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="flex gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={acceptanceRequired}
            onChange={(event) => setAcceptanceRequired(event.target.checked)}
          />
          {COPY.ACCEPTANCE_REQUIRED}
        </label>
        {documentKinds.map((kind) => (
          <label key={kind} className={LABEL}>
            {DOCUMENTS[kind]}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className={FIELD_CLASS}
              onChange={(event) => setFiles((current) => ({ ...current, [kind]: event.target.files?.[0] }))}
            />
          </label>
        ))}
        <p className="text-sm text-text-muted">PDF or image, max 10 MB each. {COPY.PROVIDED_BY_COMPANY}</p>
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">
        If a response is interrupted, prepare again with the same details to retrieve the same grant.
      </p>
      <PageAction
        label={busy ? 'Preparing grant…' : COPY.SUBMIT}
        disabled={busy || blocked || !!problem}
        onClick={() => void submit()}
      />
    </form>
  );
}
