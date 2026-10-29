import { useId, useState } from 'react';
import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { useGrantPreparation, type GrantFormProps, type DocumentKind } from './useGrantPreparation';

import { FIELD_LIMITS, REGISTER_GRANT_COPY as COPY, shareCount } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { PersonFields, PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { MoreToggle } from '@components/Ledger';

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
  onCancel,
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
  const [awardDetails, setAwardDetails] = useState(false);
  const awardDetailsId = useId();
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
  const document = (kind: DocumentKind) => (
    <FileField
      {...checks.field(`${kind}Document`)}
      label={DOCUMENTS[kind]}
      showUploadHint={false}
      onFile={(file) => setFiles((current) => ({ ...current, [kind]: file ?? undefined }))}
    />
  );

  return (
    <form
      className="space-y-5 border-t border-border-subtle pt-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (held || checks.check()) void submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <fieldset
        disabled={busy || blocked || held || !canPrepare}
        className="grid min-w-0 items-start gap-6 lg:grid-cols-2"
      >
        <fieldset className="min-w-0 space-y-4">
          <legend className="pb-4 text-base font-medium">Issue details</legend>
          {award ? (
            <div className="space-y-1">
              <p className="text-base font-medium text-text-primary">{recipientName}</p>
              <p className="text-sm text-text-muted">
                {shareCount(award.availableShares, 'vested')} available to issue
              </p>
            </div>
          ) : (
            <PersonSelect
              label="Issue to"
              people={people.filter((row) => row.walletless && row.particularsRetained)}
              value={member}
              onChange={setMember}
            />
          )}
          {!award && member === 'new' && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <PersonFields
                name={name}
                residentialAddress={address}
                onName={setName}
                onResidentialAddress={setAddress}
                nameCheck={checks.field('name')}
                addressCheck={checks.field('address')}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          {award ? (
            <div className="flex flex-col gap-3">
              <MoreToggle
                open={awardDetails || !!checks.field('termsOn').error || !!checks.field('terms').error}
                controls={awardDetailsId}
                disabled={!!checks.field('termsOn').error || !!checks.field('terms').error}
                onToggle={() => setAwardDetails((current) => !current)}
              >
                {awardDetails || !!checks.field('termsOn').error || !!checks.field('terms').error
                  ? 'Hide award record details'
                  : 'Show award record details'}
              </MoreToggle>
              <div
                id={awardDetailsId}
                hidden={!(awardDetails || !!checks.field('termsOn').error || !!checks.field('terms').error)}
                className="flex flex-col gap-4"
              >
                <p className="text-sm text-text-muted">{recipientAddress}</p>
                <Field {...checks.field('termsOn')} label={COPY.TERMS_ON}>
                  <TextInput type="date" max={today} value={retainedDate} disabled />
                </Field>
                <Field {...checks.field('terms')} label={COPY.TERMS}>
                  <TextArea maxLength={FIELD_LIMITS.TERMS} rows={3} value={retainedSummary} disabled />
                </Field>
              </div>
            </div>
          ) : (
            <fieldset className="min-w-0 space-y-4">
              <legend className="sr-only">Agreement</legend>
              <Field {...checks.field('termsOn')} label={COPY.TERMS_ON}>
                <TextInput
                  type="date"
                  max={today}
                  value={retainedDate}
                  onChange={(event) => setTermsOn(event.target.value)}
                />
              </Field>
              <Field {...checks.field('terms')} label={COPY.TERMS}>
                <TextArea
                  maxLength={FIELD_LIMITS.TERMS}
                  rows={3}
                  value={retainedSummary}
                  onChange={(event) => setTerms(event.target.value)}
                />
              </Field>
              {document('terms')}
            </fieldset>
          )}
        </fieldset>
        <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <legend className="pb-4 text-base font-medium">Company authority</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field {...checks.field('director')} label={COPY.DIRECTOR}>
              <TextInput
                maxLength={FIELD_LIMITS.DIRECTOR}
                value={approvingDirector}
                onChange={(event) => setApprovingDirector(event.target.value)}
              />
            </Field>
            <Field {...checks.field('reference')} label={COPY.AUTHORITY_REFERENCE}>
              <TextInput
                maxLength={FIELD_LIMITS.REFERENCE}
                value={authorityReference}
                onChange={(event) => setAuthorityReference(event.target.value)}
              />
            </Field>
          </div>
          <Field {...checks.field('reason')} label={COPY.REASON}>
            <TextArea
              maxLength={FIELD_LIMITS.REASON}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {document('authority')}
          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={acceptanceRequired}
              onChange={(event) => setAcceptanceRequired(event.target.checked)}
            />
            {COPY.ACCEPTANCE_REQUIRED}
          </label>
          {documentKinds.includes('acceptance') && document('acceptance')}
        </fieldset>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {held && (
        <p className="text-sm text-text-muted">
          Recover the original preparation before starting another. Preparation creates no issued shares.
        </p>
      )}
      <FormActions>
        {onCancel && <PageAction label="Cancel" disabled={busy || held} onClick={onCancel} />}
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
