import { useGrantPreparation, type GrantFormProps, type DocumentKind } from './useGrantPreparation';

import { REGISTER_GRANT_COPY as COPY, formatShareCount } from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';

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
}: GrantFormProps) {
  const model = useGrantPreparation({
    owner,
    guard,
    company,
    token,
    appointment,
    blocked,
    onRefused,
    award,
    awardMember,
    visible,
    onHeldChange,
    canPrepare,
  });
  if (model === null) return null;
  const {
    today,
    member,
    setMember,
    name,
    setName,
    address,
    setAddress,
    shares,
    setShares,
    companyEventOn,
    setCompanyEventOn,
    setTermsOn,
    approvingDirector,
    setApprovingDirector,
    setTerms,
    authorityReference,
    setAuthorityReference,
    reason,
    setReason,
    acceptanceRequired,
    setAcceptanceRequired,
    setFiles,
    busy,
    held,
    error,
    documentKinds,
    recipientName,
    recipientAddress,
    retainedDate,
    retainedSummary,
    problem,
    submit,
  } = model;

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
          {COPY.COMPANY_EVENT_ON}
          <input
            type="date"
            max={today}
            className={FIELD_CLASS}
            value={companyEventOn}
            onChange={(event) => setCompanyEventOn(event.target.value)}
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
        {award && <p className="text-sm text-text-muted">The retained award agreement will be used for this issue.</p>}
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
      <div className="flex justify-end border-t border-border-subtle pt-4">
        <PageAction
          primary
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
      </div>
    </form>
  );
}
