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
          <label className={LABEL}>
            {COPY.NAME}
            <input
              value={draft.name}
              maxLength={255}
              className={FIELD_CLASS}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.RESIDENTIAL_ADDRESS}
            <input
              value={draft.address}
              maxLength={1000}
              className={FIELD_CLASS}
              onChange={(event) => update({ address: event.target.value })}
            />
          </label>
          <label className={LABEL}>
            {COPY.AS_AT}
            <input
              type="date"
              max={today}
              value={draft.asAt}
              className={FIELD_CLASS}
              onChange={(event) => update({ asAt: event.target.value })}
            />
          </label>
          <p className="text-sm text-text-muted">{COPY.AS_AT_NOTE}</p>
        </fieldset>
        <label className={LABEL}>
          {COPY.REASON}
          <textarea
            rows={3}
            value={draft.reason}
            maxLength={1000}
            className={FIELD_CLASS}
            onChange={(event) => update({ reason: event.target.value })}
          />
        </label>
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
