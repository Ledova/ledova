import { Field, TextArea, TextInput } from '@components/Field';
import { FIELD_LIMITS } from '@ledova/shared';
import { useParticularsPreparation, type ParticularsFormProps, COPY } from './useParticularsPreparation';

import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';

const EVIDENCE = 'application/pdf,image/png,image/jpeg';

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

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Evidence provided by the company</legend>
          <label className={LABEL}>
            {COPY.SUPPORTING_DOCUMENT}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => update({ file: event.target.files?.[0] ?? null })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.SUPPORTING_DOCUMENT_NOTE}</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">{COPY.PROPOSED_PARTICULARS}</legend>
          <Field label={COPY.NAME}>
            <TextInput
              value={draft.name}
              maxLength={FIELD_LIMITS.NAME}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field label={COPY.RESIDENTIAL_ADDRESS}>
            <TextInput
              value={draft.address}
              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
              onChange={(event) => update({ address: event.target.value })}
            />
          </Field>
          <Field label={COPY.AS_AT} hint={COPY.AS_AT_NOTE}>
            <TextInput
              type="date"
              max={today}
              value={draft.asAt}
              onChange={(event) => update({ asAt: event.target.value })}
            />
          </Field>
        </fieldset>
        <Field label={COPY.REASON}>
          <TextArea
            rows={3}
            value={draft.reason}
            maxLength={FIELD_LIMITS.REASON}
            onChange={(event) => update({ reason: event.target.value })}
          />
        </Field>
      </fieldset>
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
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
          disabled={blocked || problems.length > 0}
        />
      </FormActions>
    </form>
  );
}
