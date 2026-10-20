import { Field, TextInput } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
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
}: {
  company: CompanyListItem;
  disabled: boolean;
  guard: () => void;
  onSuccess: (request: CompanyAuthorityRequest) => void;
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
    ready,
    toggle,
    send,
  } = useAuthorityRequestForm({
    company,
    disabled,
    guard,
    onSuccess,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-text-muted">
        Company information is provided by the company. Submit a private request for your own representative role at{' '}
        {company.name}, then accept the authorisation declaration to establish your appointment. Submitting evidence
        alone grants no authority and does not activate the company.
      </p>
      <p className="text-sm text-text-muted">
        Initial admission requires Manage company information and team in your own requested actions. Your evidence and
        request history remain private to your account; no ASIC extract is required.
      </p>
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
      <Field label="Requested expiry date (UTC, optional)">
        <TextInput
          type="date"
          min={utcToday()}
          value={expiry}
          disabled={disabled || busy}
          onChange={(event) => change(() => setExpiry(event.target.value))}
        />
      </Field>
      <label className={LABEL}>
        Supporting document (optional)
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={disabled || busy}
          onChange={(event) => change(() => setFile(event.target.files?.[0] ?? null))}
          className={FIELD_CLASS}
        />
      </label>
      <p className="text-sm text-text-muted">
        Optional PDF or image, max 10 MB. Supporting documents can also be uploaded later in Company settings.
      </p>
      {submission.isError && (
        <p role="alert" className="text-sm text-error-light">
          {failureSentence(submission.error, 'The request could not be recorded. Retry with the same details.')}
        </p>
      )}
      <FormActions>
        <PageAction
          type="submit"
          label="Submit authority request"
          busy={busy}
          busyLabel="Submitting…"
          primary
          disabled={!ready}
        />
      </FormActions>
    </form>
  );
}
