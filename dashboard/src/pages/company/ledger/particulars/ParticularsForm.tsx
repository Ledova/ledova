import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { FIELD_LIMITS } from '@ledova/shared';
import { useParticularsPreparation, type ParticularsFormProps, COPY } from './useParticularsPreparation';

import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

export function ParticularsForm({
  owner,
  guard,
  company,
  member,
  appointment,
  current,
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
    current,
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
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Field {...checks.field('name')} label={COPY.NAME}>
          <TextInput
            value={draft.name}
            maxLength={FIELD_LIMITS.NAME}
            onChange={(event) => update({ name: event.target.value })}
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
        <Field {...checks.field('address')} label={COPY.RESIDENTIAL_ADDRESS} className="sm:col-span-2">
          <TextArea
            rows={3}
            value={draft.address}
            maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
            onChange={(event) => update({ address: event.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <FileField
            {...checks.field('file')}
            label={COPY.SUPPORTING_DOCUMENT}
            hint={COPY.SUPPORTING_DOCUMENT_NOTE}
            onFile={(file) => update({ file })}
          />
        </div>
        <Field {...checks.field('reason')} label={COPY.REASON} className="sm:col-span-2">
          <TextArea
            rows={3}
            value={draft.reason}
            maxLength={FIELD_LIMITS.REASON}
            onChange={(event) => update({ reason: event.target.value })}
          />
        </Field>
      </fieldset>
      <Failure>{error}</Failure>
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
