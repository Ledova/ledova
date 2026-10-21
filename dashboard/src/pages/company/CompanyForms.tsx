import { Field, TextInput } from '@components/Field';
import { Modal } from '@components/Modal';
import { apiErrorSentence } from '@ledova/shared';
import { CompanyReadNotice } from '@pages/company/shared/CompanyState';
import { EDIT_FIELDS, useEditCompanyForm, type FormProps } from './useCompanyForms';

export function EditCompanyForm(props: FormProps) {
  const { company, target, read, onClose, draft, setDraft, pendingRef, canChangeName, valid, save } =
    useEditCompanyForm(props);
  return (
    <Modal
      isOpen
      title="Edit company"
      size="lg"
      showFooter
      confirmLabel="Save changes"
      busy={save.isPending}
      busyLabel="Saving changes…"
      confirmDisabled={!valid}
      onConfirm={() => {
        if (valid && !pendingRef.current) {
          pendingRef.current = true;
          save.mutate();
        }
      }}
      onClose={onClose}
    >
      <fieldset disabled={save.isPending} className="space-y-4">
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
        {save.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(
              save.error,
              'Company changes could not be saved. Try again.',
              'The company changes could not be confirmed. Refresh before retrying.',
            )}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {EDIT_FIELDS.map(([key, label, maxLength]) => (
            <Field
              key={key}
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
      </fieldset>
    </Modal>
  );
}
