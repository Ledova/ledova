import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { useGrantPreparation, type GrantFormProps, type DocumentKind } from './useGrantPreparation';

import { FIELD_LIMITS, REGISTER_GRANT_COPY as COPY, shareCount, shortReference } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { PersonFields, PersonSelect } from '@pages/company/register/shared/PersonPicker';
import { Disclosure } from '@components/Ledger';

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
  people,
  appointment,
  blocked,
  onRefused,
  onRecorded,
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
    people,
    appointment,
    blocked,
    onRefused,
    onRecorded,
    award,
    awardMember,
    visible,
    onHeldChange,
    canPrepare,
  });
  const checks = useErrorSummary(model?.problems ?? {});
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
    submit,
  } = model;

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (held || checks.check()) void submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={busy || blocked || held || !canPrepare} className="space-y-4">
        {award ? (
          <div className="space-y-2">
            <p className="text-base font-medium text-text-primary">{recipientName}</p>
            <p className="text-sm text-text-muted">{recipientAddress}</p>
            <p className="text-sm text-text-muted">
              {shareCount(award.availableShares, 'vested')} available to issue. The recipient and agreement are fixed;
              company approval and recording the issue remain separate.
            </p>
            <Disclosure summary="Award record details">
              <p className="text-sm text-text-muted">
                Award {shortReference(award.uuid)} · Member {shortReference(award.member)}
              </p>
            </Disclosure>
          </div>
        ) : (
          <PersonSelect
            label="Issue to"
            people={people.filter((row) => row.walletless && row.particularsRetained)}
            value={member}
            onChange={setMember}
          />
        )}
        {!award && member === 'new' ? (
          <PersonFields
            name={name}
            residentialAddress={address}
            onName={setName}
            onResidentialAddress={setAddress}
            nameCheck={checks.field('name')}
            addressCheck={checks.field('address')}
          />
        ) : !award ? (
          <p className="text-sm text-text-muted">
            The grant retains the existing member’s current particulars. Preview them before approval.
          </p>
        ) : null}
        <Field {...checks.field('shares')} label={COPY.SHARES}>
          <TextInput
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            inputMode="numeric"
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </Field>
        <Field {...checks.field('companyEventOn')} label={COPY.COMPANY_EVENT_ON}>
          <TextInput
            type="date"
            max={today}
            value={companyEventOn}
            onChange={(event) => setCompanyEventOn(event.target.value)}
          />
        </Field>
        <Field {...checks.field('termsOn')} label={COPY.TERMS_ON}>
          <TextInput
            type="date"
            max={today}
            value={retainedDate}
            disabled={!!award}
            onChange={(event) => setTermsOn(event.target.value)}
          />
        </Field>
        <Field {...checks.field('terms')} label={COPY.TERMS}>
          <TextArea
            maxLength={FIELD_LIMITS.TERMS}
            rows={3}
            value={retainedSummary}
            disabled={!!award}
            onChange={(event) => setTerms(event.target.value)}
          />
        </Field>
        <Field {...checks.field('director')} label={COPY.DIRECTOR}>
          <TextInput
            maxLength={FIELD_LIMITS.DIRECTOR}
            value={approvingDirector}
            onChange={(event) => setApprovingDirector(event.target.value)}
          />
        </Field>
        <p className="text-sm text-text-muted">
          {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </p>
        <Field {...checks.field('reference')} label={COPY.AUTHORITY_REFERENCE}>
          <TextInput
            maxLength={FIELD_LIMITS.REFERENCE}
            value={authorityReference}
            onChange={(event) => setAuthorityReference(event.target.value)}
          />
        </Field>
        <Field {...checks.field('reason')} label={COPY.REASON}>
          <TextArea
            maxLength={FIELD_LIMITS.REASON}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <label className="flex gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={acceptanceRequired}
            onChange={(event) => setAcceptanceRequired(event.target.checked)}
          />
          {COPY.ACCEPTANCE_REQUIRED}
        </label>
        {documentKinds.map((kind) => (
          <FileField
            key={kind}
            {...checks.field(`${kind}Document`)}
            label={DOCUMENTS[kind]}
            onFile={(file) => setFiles((current) => ({ ...current, [kind]: file ?? undefined }))}
          />
        ))}
        <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
        {award && <p className="text-sm text-text-muted">The retained award agreement will be used for this issue.</p>}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">
        If a response is interrupted, recover the original preparation before starting another. Preparation creates no
        issued shares.
      </p>
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={held ? 'Recover original grant preparation' : award ? 'Prepare vested share issue' : COPY.SUBMIT}
          busy={busy}
          busyLabel="Preparing grant…"
          disabled={blocked || (!held && !canPrepare)}
        />
      </FormActions>
    </form>
  );
}
