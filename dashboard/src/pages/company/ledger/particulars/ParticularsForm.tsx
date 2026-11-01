import { Field, TextArea, TextInput } from '@components/Field';
import { FIELD_LIMITS } from '@ledova/shared';
import { useParticularsEdit, type ParticularsFormProps, COPY } from './useParticularsEdit';

import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

export function ParticularsForm(props: ParticularsFormProps) {
  const { draft, busy, error, conflict, update, reload, problems, submit } = useParticularsEdit(props);
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
      <fieldset disabled={busy} className="grid gap-4">
        <Field {...checks.field('name')} label={COPY.NAME}>
          <TextInput
            value={draft.name}
            maxLength={FIELD_LIMITS.NAME}
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        <Field {...checks.field('address')} label={COPY.RESIDENTIAL_ADDRESS}>
          <TextArea
            rows={3}
            value={draft.address}
            maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
            onChange={(event) => update({ address: event.target.value })}
          />
        </Field>
        <Field label={COPY.REASON} optional hint={COPY.REASON_NOTE}>
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
        {conflict && <PageAction label={COPY.RELOAD} onClick={reload} />}
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Saving change…"
          disabled={props.blocked || conflict}
        />
      </FormActions>
    </form>
  );
}
