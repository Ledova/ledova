import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Choices } from '@components/Choices';
import { useOpeningPreparation, type OpeningFormProps, COPY } from './useOpeningPreparation';

import { FIELD_LIMITS, type RegisterCorrectionAuthority, shareCount } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { SearchSelect } from '@components/SearchSelect';

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

const MEMBERS = ['member', 'members'] as const;

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
}: OpeningFormProps) {
  const {
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
  } = useOpeningPreparation({ owner, guard, company, token, holders, appointment, blocked, onConflict, onMissing });
  const memberChoices = [...labels].map(([value, label]) => ({ value, label }));
  const checks = useErrorSummary(problems);

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (checks.check()) void submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Evidence provided by the company</legend>
          <FileField
            {...checks.field('file')}
            label={COPY.AUTHORITY_DOCUMENT}
            hint={COPY.AUTHORITY_DOCUMENT_NOTE}
            onFile={(file) => update({ file })}
          />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Authority and reason</legend>
          <Choices
            legend={COPY.AUTHORITY}
            options={AUTHORITIES}
            value={draft.authority}
            onChange={(authority) => update({ authority })}
          />
          {draft.authority === 'director_resolution' && (
            <Field {...checks.field('director')} label={COPY.APPROVING_DIRECTOR}>
              <TextInput
                value={draft.director}
                maxLength={FIELD_LIMITS.DIRECTOR}
                onChange={(event) => update({ director: event.target.value })}
              />
            </Field>
          )}
          <Field {...checks.field('reference')} label={COPY.AUTHORITY_REFERENCE}>
            <TextInput
              value={draft.reference}
              maxLength={FIELD_LIMITS.REFERENCE}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </Field>
          <Field {...checks.field('reason')} label={COPY.REASON}>
            <TextArea
              rows={3}
              value={draft.reason}
              maxLength={FIELD_LIMITS.REASON}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </Field>
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
                <SearchSelect
                  label={COPY.MEMBER}
                  choices={memberChoices}
                  value={memberOf(holding)}
                  onChange={(value) => choose(holding, value)}
                  noun={MEMBERS}
                />
              )}
            </fieldset>
          ))}
        </fieldset>
      </fieldset>
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
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Preparing opening…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}
