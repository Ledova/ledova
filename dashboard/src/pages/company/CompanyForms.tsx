import { Field, TextInput } from '@components/Field';
import { Modal } from '@components/Modal';
import { readApiError } from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { CompanyReadNotice } from '@pages/company/shared/CompanyState';
import { EDIT_FIELDS, useEditCompanyForm, type FormProps } from './useCompanyForms';

export function EditCompanyForm(props: FormProps) {
  const {
    company,
    target,
    read,
    onClose,
    draft,
    setDraft,
    pendingRef,
    canChangeName,
    changed,
    available,
    problems,
    save,
  } = useEditCompanyForm(props);
  const checks = useErrorSummary(problems);
  const reading = save.isError
    ? readApiError(save.error, {
        fallback: 'Company changes could not be saved. Try again.',
        unanswered: 'The company changes could not be confirmed. Refresh before retrying.',
        displayedFields: EDIT_FIELDS.map(([key]) => key),
      })
    : null;
  return (
    <Modal
      isOpen
      title="Edit company"
      size="lg"
      showFooter
      confirmLabel="Save changes"
      busy={save.isPending}
      busyLabel="Saving changes…"
      confirmDisabled={!available}
      onConfirm={() => {
        if (available && checks.check() && !pendingRef.current) {
          pendingRef.current = true;
          save.mutate();
        }
      }}
      onClose={onClose}
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
                maxLength={maxLength}
                value={draft[key]}
                disabled={key === 'name' && !canChangeName}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </Field>
          ))}
        </div>
        {!changed && <p className="text-sm text-text-muted">Change a detail to save.</p>}
      </fieldset>
    </Modal>
  );
}
