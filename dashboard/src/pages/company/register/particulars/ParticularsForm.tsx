import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { FIELD_LIMITS } from '@ledova/shared';
import { useParticularsPreparation, type ParticularsFormProps, COPY } from './useParticularsPreparation';

import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';

export function ParticularsForm({
  owner,
  guard,
  company,
  member,
  appointment,
  blocked,
  onConflict,
  onMissing,
}: ParticularsFormProps) {
  const { today, draft, busy, error, update, problems, submit } = useParticularsPreparation({
    owner,
    guard,
    company,
    member,
    appointment,
    blocked,
    onConflict,
    onMissing,
  });
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
            label={COPY.SUPPORTING_DOCUMENT}
            hint={COPY.SUPPORTING_DOCUMENT_NOTE}
            onFile={(file) => update({ file })}
          />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">{COPY.PROPOSED_PARTICULARS}</legend>
          <Field {...checks.field('name')} label={COPY.NAME}>
            <TextInput
              value={draft.name}
              maxLength={FIELD_LIMITS.NAME}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field {...checks.field('address')} label={COPY.RESIDENTIAL_ADDRESS}>
            <TextInput
              value={draft.address}
              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
              onChange={(event) => update({ address: event.target.value })}
            />
          </Field>
          <Field {...checks.field('asAt')} label={COPY.AS_AT} hint={COPY.AS_AT_NOTE}>
            <TextInput
              type="date"
              max={today}
              value={draft.asAt}
              onChange={(event) => update({ asAt: event.target.value })}
            />
          </Field>
        </fieldset>
        <Field {...checks.field('reason')} label={COPY.REASON}>
          <TextArea
            rows={3}
            value={draft.reason}
            maxLength={FIELD_LIMITS.REASON}
            onChange={(event) => update({ reason: event.target.value })}
          />
        </Field>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Preparing change…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}
