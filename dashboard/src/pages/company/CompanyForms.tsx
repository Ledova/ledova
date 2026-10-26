import { Field, TextInput } from '@components/Field';
import { useEffect, useRef } from 'react';
import { FormActions, PageAction } from '@components/Page';
import { readApiError } from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { CompanyReadNotice } from '@pages/company/shared/CompanyState';
import { EDIT_FIELDS, useEditCompanyForm, type FormProps } from './useCompanyForms';

export function EditCompanyForm(props: FormProps) {
  const { company, target, read, onClose, draft, setDraft, pendingRef, canChangeName, available, problems, save } =
    useEditCompanyForm(props);
  const checks = useErrorSummary(problems);
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => firstField.current?.focus(), []);
  const reading = save.isError
    ? readApiError(save.error, {
        fallback: 'Company changes could not be saved. Try again.',
        unanswered: 'The company changes could not be confirmed. Refresh before retrying.',
        displayedFields: EDIT_FIELDS.map(([key]) => key),
      })
    : null;
  return (
    <form
      aria-label="Edit company"
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (available && checks.check() && !pendingRef.current) {
          pendingRef.current = true;
          save.mutate();
        }
      }}
    >
      <fieldset disabled={save.isPending} className="space-y-4">
        <ErrorSummary {...checks.summary} />
        <CompanyReadNotice read={read} />
        {company?.uuid !== target.uuid && (
          <p role="alert" className="text-sm text-text-muted">
            This draft belongs to a company that is no longer selected.
          </p>
        )}
        {!canChangeName && (
          <p className="text-sm text-text-muted">
            The registered name can change only while the application is a draft or information has been requested.
          </p>
        )}
        {reading && (
          <p role="alert" className="text-sm text-error-light">
            {reading.generalError ?? 'The company changes were not saved. Check the fields below.'}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {EDIT_FIELDS.map(([key, label, maxLength]) => (
            <Field
              key={key}
              id={checks.field(key).id}
              error={checks.field(key).error ?? reading?.fieldErrors?.[key]?.join(' ') ?? null}
              label={label}
              className={['name', 'addressLine1', 'addressLine2'].includes(key) ? 'sm:col-span-2' : undefined}
            >
              <TextInput
                ref={key === (canChangeName ? 'name' : 'tradingName') ? firstField : undefined}
                maxLength={maxLength}
                value={draft[key]}
                disabled={key === 'name' && !canChangeName}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <FormActions>
        <PageAction label="Cancel" disabled={save.isPending} onClick={onClose} />
        <PageAction
          type="submit"
          label="Save changes"
          primary
          disabled={!available}
          busy={save.isPending}
          busyLabel="Saving changes…"
        />
      </FormActions>
    </form>
  );
}
