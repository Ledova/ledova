import { useId } from 'react';
import { Field, TextInput, FileField } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FormActions, PageAction } from '@components/Page';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  type CompanyAuthorityRequest,
  type CompanyListItem,
  failureSentence,
  utcToday,
} from '@ledova/shared';
import { useAuthorityRequestForm } from './useAuthorityRequestForm';

export function AuthorityRequestForm({
  company,
  disabled,
  guard,
  onSuccess,
  onCancel,
}: {
  company: CompanyListItem;
  disabled: boolean;
  guard: () => void;
  onSuccess: (request: CompanyAuthorityRequest) => void;
  onCancel: () => void;
}) {
  const {
    setFile,
    requested,
    setRequested,
    delegatable,
    setDelegatable,
    expiry,
    setExpiry,
    submission,
    change,
    busy,
    problems,
    watchDate,
    toggle,
    send,
  } = useAuthorityRequestForm({
    company,
    disabled,
    guard,
    onSuccess,
  });
  const checks = useErrorSummary(problems);
  const actions = checks.field('actions');
  const actionsError = useId();
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (checks.check()) void send();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">
        Company information is provided by the company. Submit a private request for your own representative role at{' '}
        {company.name}, then accept the authorisation declaration to establish your appointment. Submitting evidence
        alone grants no authority and does not activate the company.
      </p>
      <p className="text-sm text-text-muted">
        Initial admission requires Manage company information and team in your own requested actions. Your evidence and
        request history remain private to your account; no ASIC extract is required.
      </p>
      <div id={actions.id}>
        <div className="grid gap-5 sm:grid-cols-2">
          {(['requested', 'delegatable'] as const).map((scope) => {
            const values = scope === 'requested' ? requested : delegatable;
            const set = scope === 'requested' ? setRequested : setDelegatable;
            return (
              <fieldset key={scope} disabled={disabled || busy} className="space-y-2">
                <legend className="text-sm font-medium text-text-primary">
                  {scope === 'requested'
                    ? 'Actions you request for yourself'
                    : 'Actions you request permission to delegate'}
                </legend>
                {COMPANY_AUTHORITY_CAPABILITIES.map(({ value, label }) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      aria-invalid={actions.error ? true : undefined}
                      aria-describedby={actions.error ? actionsError : undefined}
                      checked={values.includes(value)}
                      onChange={() => change(() => set(toggle(values, value)))}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        {actions.error && (
          <p id={actionsError} className="mt-1 text-sm text-error-light">
            {actions.error}
          </p>
        )}
      </div>
      <Field {...checks.field('expiry')} label="Expiry date (UTC)">
        <TextInput
          type="date"
          min={utcToday()}
          value={expiry}
          {...watchDate('expiry')}
          disabled={disabled || busy}
          onChange={(event) => change(() => setExpiry(event.target.value))}
        />
      </Field>
      <FileField
        label="Supporting document"
        showUploadHint={false}
        hint="Supporting documents can also be uploaded later in Documents → Supporting."
        disabled={disabled || busy}
        onFile={(file) => change(() => setFile(file))}
      />
      {submission.isError && (
        <p role="alert" className="text-sm text-error-light">
          {failureSentence(submission.error, 'The request could not be recorded. Retry with the same details.')}
        </p>
      )}
      <FormActions>
        <PageAction label="Cancel" disabled={disabled || busy} onClick={onCancel} />
        <PageAction
          type="submit"
          label="Submit authority request"
          busy={busy}
          busyLabel="Submitting…"
          primary
          disabled={disabled}
        />
      </FormActions>
    </form>
  );
}
