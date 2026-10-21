import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Choices } from '@components/Choices';
import { useCorrectionPreparation, type CorrectionFormProps, COPY } from './useCorrectionPreparation';

import { FIELD_LIMITS, type RegisterCorrectionAuthority } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';

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
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Evidence provided by the company</legend>
          <FileField
            {...checks.field('file')}
            label={COPY.AUTHORITY_DOCUMENT}
            hint={COPY.AUTHORITY_DOCUMENT_NOTE}
            onFile={(file) => update({ file })}
          />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Effective date and authority</legend>
          <Field {...checks.field('effectiveOn')} label={COPY.EFFECTIVE_ON} hint={COPY.EFFECTIVE_ON_NOTE}>
            <TextInput
              type="date"
              max={today}
              value={draft.effectiveOn}
              onChange={(event) => update({ effectiveOn: event.target.value })}
            />
          </Field>
          <Choices
            legend={COPY.AUTHORITY}
            options={AUTHORITIES}
            value={draft.authority}
            onChange={(authority) => update({ authority })}
          />
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
          <Field {...checks.field('reason')} label={COPY.REASON}>
            <TextArea
              rows={3}
              value={draft.reason}
              maxLength={FIELD_LIMITS.REASON}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </Field>
        </fieldset>
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
          busyLabel="Preparing correction…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}
