import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, TextArea, TextInput } from '@components/Field';
import { FIELD_LIMITS, REGISTER_PARTICULARS_COPY as COPY, useParticularsEdit } from '@ledova/shared';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

type ParticularsFormProps = Omit<Parameters<typeof useParticularsEdit>[0], 'onChanged' | 'newKey' | 'session'>;

export function ParticularsForm(props: ParticularsFormProps) {
  const navigate = useNavigate();
  const { draft, busy, error, conflict, update, reload, problems, submit } = useParticularsEdit({
    ...props,
    newKey: () => crypto.randomUUID(),
    onChanged: (record) => {
      const place = registerPlace({
        company: props.company,
        task: 'corrections',
        record,
        outcome: 'Particulars changed.',
      });
      navigate(place.to, { state: place.state });
    },
  });
  const checks = useErrorSummary(problems);
  const reloadAction = useRef<HTMLButtonElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (conflict) reloadAction.current?.focus();
  }, [conflict]);

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
            ref={nameField}
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
        <Field label={COPY.REASON} optional>
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
        {conflict && (
          <PageAction
            ref={reloadAction}
            label={COPY.RELOAD}
            onClick={() => {
              reload();
              nameField.current?.focus();
            }}
          />
        )}
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
