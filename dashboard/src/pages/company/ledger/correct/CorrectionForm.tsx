import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Choices } from '@components/Choices';
import { useCorrectionPreparation, type CorrectionFormProps, COPY } from './useCorrectionPreparation';

import { FIELD_LIMITS, type RegisterCorrectionAuthority } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

export function CorrectionForm({
  owner,
  guard,
  company,
  token,
  entry,
  appointment,
  blocked,
  onConflict,
}: CorrectionFormProps) {
  const { today, draft, busy, error, update, problems, submit } = useCorrectionPreparation({
    owner,
    guard,
    company,
    token,
    entry,
    appointment,
    blocked,
    onConflict,
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
        <div className="sm:col-span-2">
          <Choices
            legend={COPY.AUTHORITY}
            options={AUTHORITIES}
            value={draft.authority}
            onChange={(authority) => update({ authority })}
          />
        </div>
        {draft.authority === 'director_resolution' && (
          <Field {...checks.field('director')} label={COPY.APPROVING_DIRECTOR}>
            <TextInput
              value={draft.director}
              maxLength={FIELD_LIMITS.DIRECTOR}
              onChange={(event) => update({ director: event.target.value })}
            />
          </Field>
        )}
        <Field {...checks.field('reference')} label={COPY.AUTHORITY_REFERENCE}>
          <TextInput
            value={draft.reference}
            maxLength={FIELD_LIMITS.REFERENCE}
            onChange={(event) => update({ reference: event.target.value })}
          />
        </Field>
        <Field {...checks.field('effectiveOn')} label={COPY.EFFECTIVE_ON} hint={COPY.EFFECTIVE_ON_NOTE}>
          <TextInput
            type="date"
            max={today}
            value={draft.effectiveOn}
            onChange={(event) => update({ effectiveOn: event.target.value })}
          />
        </Field>
        <FileField
          {...checks.field('file')}
          label={COPY.AUTHORITY_DOCUMENT}
          hint={COPY.AUTHORITY_DOCUMENT_NOTE}
          onFile={(file) => update({ file })}
        />
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
          busyLabel="Preparing correction…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}
