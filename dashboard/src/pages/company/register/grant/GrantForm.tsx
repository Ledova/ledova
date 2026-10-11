import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_GRANT_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  formatShareCount,
  getRegisterGrants,
  isPreparedRegisterGrant,
  isRegisterEvidenceReceipt,
  prepareRegisterGrant,
  readEveryPage,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterGrantPreparation,
  type RegisterAward,
  type RegisterTransferMember,
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
  award,
  awardMember,
  visible = true,
  onHeldChange,
  canPrepare = true,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  members: TokenHoldersResponse['holders'];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onRefused: () => void;
  award?: RegisterAward;
  awardMember?: RegisterTransferMember | null;
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
  canPrepare?: boolean;
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
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<DocumentKind, Uploaded>>>({});
  const operation = useRef<{ request: RegisterGrantPreparation; confirmed: boolean; uncertain: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and register records before continuing.');
    if (!mounted.current) throw createUserFriendlyError('This grant form is closed. Reopen it before continuing.');
  };
  const documentKinds: DocumentKind[] = acceptanceRequired
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  const newRecipient = award ? !awardMember : member === 'new';
  const recipientName = award ? (awardMember?.name ?? award.name) : name.trim();
  const recipientAddress = award ? (awardMember?.residentialAddress ?? award.residentialAddress) : address.trim();
  const retainedDate = award?.termsOn ?? termsOn;
  const retainedSummary = award?.terms ?? terms.trim();
  const problem =
    newRecipient && (!recipientName || !recipientAddress)
      ? 'Give the new member’s name and residential address.'
      : !/^[1-9]\d*$/.test(shares)
        ? 'Enter a positive whole number of shares.'
        : award && BigInt(shares) > BigInt(award.availableShares)
          ? 'The grant quantity must fit the award’s vested and not yet issued shares.'
          : !/^\d{4}-\d{2}-\d{2}$/.test(retainedDate) || retainedDate > today
            ? 'Enter a terms date no later than today (UTC).'
            : !retainedSummary || !approvingDirector.trim() || !authorityReference.trim() || !reason.trim()
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
  const lookup = async (request: RegisterGrantPreparation) => {
    const rows = await readEveryPage(async (page) => {
      check();
      const response = await getRegisterGrants(apiClient, { token, page }, { ledovaSubmissionGuard: check });
      check();
      return response;
    });
    if (rows.some((row) => row.company !== company || row.token !== token))
      throw createUserFriendlyError('The grants did not identify this company and share class.');
    const original = rows.find((row) => row.uuid === request.operationId);
    if (original && !isPreparedRegisterGrant(original, request))
      throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
    return original;
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && problem)) return;
    pending.current = true;
    setBusy(true);
    onHeldChange?.(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        if (!canPrepare) throw createUserFriendlyError('Current preparation authority is required to prepare a grant.');
        const authority = await upload('authority');
        const retainedTerms = await upload('terms');
        if (award && retainedTerms.sha256 !== award.agreementFingerprint)
          throw createUserFriendlyError('Upload the same agreement document retained for this award.');
        const acceptance = acceptanceRequired ? await upload('acceptance') : null;
        const request: RegisterGrantPreparation = {
          operationId: crypto.randomUUID(),
          appointment: appointment.uuid,
          tokenId: token,
          member: award?.member ?? (newRecipient ? newMemberId : member),
          newMember: newRecipient,
          ...(newRecipient ? { name: recipientName, residentialAddress: recipientAddress } : {}),
          ...(award ? { award: award.uuid } : {}),
          shares,
          termsOn: retainedDate,
          terms: retainedSummary,
          approvingDirector: approvingDirector.trim(),
          authorityReference: authorityReference.trim(),
          reason: reason.trim(),
          authorityEvidence: authority.uuid,
          termsEvidence: retainedTerms.uuid,
          acceptanceRequired,
          acceptanceEvidence: acceptance?.uuid ?? null,
        };
        command = { request, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
      }
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        command.confirmed = !!(await lookup(command.request));
        absent = !command.confirmed;
      }
      if (!command.confirmed) {
        try {
          check();
          const { data } = await prepareRegisterGrant(apiClient, command.request, { ledovaSubmissionGuard: check });
          check();
          if (!isPreparedRegisterGrant(data, command.request))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (failure) {
          const status = failureStatus(failure);
          if (!absent || !status || status < 400 || status >= 500) throw failure;
          command.confirmed = !!(await lookup(command.request));
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            setError(
              'The original grant was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await client.invalidateQueries({ queryKey: grantsKey(owner, token) });
      check();
      operation.current = null;
      setHeld(false);
      onHeldChange?.(false);
      navigate(
        `${DESTINATIONS.companyRegister.path}${award ? '#awards' : ''}`,
        award ? { state: { awardIssueToken: token, awardIssueCompany: company } } : undefined,
      );
    } catch (failure) {
      const status = failureStatus(failure);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          setHeld(false);
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(failure, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) onRefused();
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        onHeldChange?.(!!operation.current);
      }
    }
  };
  if (!visible) return null;
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy || blocked || held || !canPrepare} className="space-y-4">
        {award ? (
          <div className="space-y-2">
            <p className="text-base font-medium text-text-primary">{recipientName}</p>
            <p className="text-sm text-text-muted">{recipientAddress}</p>
            <p className="text-sm text-text-muted">
              {formatShareCount(award.availableShares)} vested shares available to issue. The recipient and agreement
              are fixed; company approval and recording the issue remain separate.
            </p>
            <details>
              <summary className="cursor-pointer py-2 text-sm">Award record details</summary>
              <p className="text-sm text-text-muted">
                Award {award.uuid} · Member {award.member}
              </p>
            </details>
          </div>
        ) : (
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
        )}
        {!award && member === 'new' ? (
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
        ) : !award ? (
          <p className="text-sm text-text-muted">
            The grant retains the existing member’s current particulars. Preview them before approval.
          </p>
        ) : null}
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
            value={retainedDate}
            disabled={!!award}
            onChange={(event) => setTermsOn(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.TERMS}
          <textarea
            className={FIELD_CLASS}
            maxLength={1000}
            rows={3}
            value={retainedSummary}
            disabled={!!award}
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
        {award && (
          <p className="text-sm text-text-muted">
            Choose the same agreement bytes as the award’s retained agreement for the terms document.
          </p>
        )}
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">
        If a response is interrupted, recover the original preparation before starting another. Preparation creates no
        issued shares.
      </p>
      <PageAction
        label={
          busy
            ? 'Preparing grant…'
            : held
              ? 'Recover original grant preparation'
              : award
                ? 'Prepare vested share issue'
                : COPY.SUBMIT
        }
        disabled={busy || blocked || (!held && (!canPrepare || !!problem))}
        onClick={() => void submit()}
      />
    </form>
  );
}
