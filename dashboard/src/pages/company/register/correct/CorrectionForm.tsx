import { Choices } from '@components/Choices';
import { useCorrectionPreparation, type CorrectionFormProps, COPY } from './useCorrectionPreparation';

import { FIELD_LIMITS, type RegisterCorrectionAuthority } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';

const EVIDENCE = 'application/pdf,image/png,image/jpeg';

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
            {COPY.AUTHORITY_DOCUMENT}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => update({ file: event.target.files?.[0] ?? null })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.AUTHORITY_DOCUMENT_NOTE}</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Effective date and authority</legend>
          <label className={LABEL}>
            {COPY.EFFECTIVE_ON}
            <input
              type="date"
              max={today}
              value={draft.effectiveOn}
              className={FIELD_CLASS}
              onChange={(event) => update({ effectiveOn: event.target.value })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.EFFECTIVE_ON_NOTE}</p>
          <Choices
            legend={COPY.AUTHORITY}
            options={AUTHORITIES}
            value={draft.authority}
            onChange={(authority) => update({ authority })}
          />
          {draft.authority === 'director_resolution' && (
            <label className={LABEL}>
              {COPY.APPROVING_DIRECTOR}
              <input
                value={draft.director}
                maxLength={FIELD_LIMITS.DIRECTOR}
                className={FIELD_CLASS}
                onChange={(event) => update({ director: event.target.value })}
              />
            </label>
          )}
          <label className={LABEL}>
            {COPY.AUTHORITY_REFERENCE}
            <input
              value={draft.reference}
              maxLength={FIELD_LIMITS.REFERENCE}
              className={FIELD_CLASS}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.REASON}
            <textarea
              rows={3}
              value={draft.reason}
              maxLength={FIELD_LIMITS.REASON}
              className={FIELD_CLASS}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </label>
        </fieldset>
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
          busyLabel="Preparing correction…"
          disabled={blocked || problems.length > 0}
        />
      </FormActions>
    </form>
  );
}
