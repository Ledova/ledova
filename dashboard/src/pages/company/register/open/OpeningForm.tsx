import { Choices } from '@components/Choices';
import { useOpeningPreparation, type OpeningFormProps, COPY } from './useOpeningPreparation';

import { type RegisterCorrectionAuthority } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { SearchSelect } from '@components/SearchSelect';

import { shareCount } from '@pages/company/shared/proposals';

const EVIDENCE = 'application/pdf,image/png,image/jpeg';

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

const MEMBERS = ['member', 'members'] as const;

export function OpeningForm({
  owner,
  guard,
  company,
  token,
  holders,
  appointment,
  blocked,
  onReload,
  onConflict,
  onMissing,
}: OpeningFormProps) {
  const {
    draft,
    busy,
    error,
    moved,
    holdings,
    unlinked,
    reset,
    memberOf,
    labels,
    problems,
    clear,
    update,
    choose,
    submit,
  } = useOpeningPreparation({ owner, guard, company, token, holders, appointment, blocked, onConflict, onMissing });
  const memberChoices = [...labels].map(([value, label]) => ({ value, label }));

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
          <legend className="text-sm font-medium text-text-primary">Authority and reason</legend>
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
                maxLength={255}
                className={FIELD_CLASS}
                onChange={(event) => update({ director: event.target.value })}
              />
            </label>
          )}
          <label className={LABEL}>
            {COPY.AUTHORITY_REFERENCE}
            <input
              value={draft.reference}
              maxLength={255}
              className={FIELD_CLASS}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </label>
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
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">{COPY.HOLDINGS}</legend>
          {holdings.length === 0 && <p className="text-sm text-text-muted">{COPY.NO_HOLDINGS}</p>}
          {unlinked.length > 0 && (
            <p className="text-sm text-text-muted">
              Each address without a linked member is recorded under the member chosen for it. Choose the same member
              for addresses that belong to one person.
            </p>
          )}
          {reset && (
            <p role="status" className="text-sm text-text-primary">
              {COPY.CHOICES_RESET}
            </p>
          )}
          {holdings.map((holding) => (
            <fieldset key={holding.address} className="space-y-2 border-t border-border-subtle pt-3">
              <legend className="break-all text-sm text-text-primary">{holding.address}</legend>
              <p className="text-xs text-text-muted">{shareCount(holding.shares)}</p>
              {holding.member !== null ? (
                <>
                  <p className="text-sm text-text-primary">{labels.get(holding.member)}</p>
                  <p className="text-sm text-text-muted">{COPY.LINKED_NOTE}</p>
                </>
              ) : (
                <SearchSelect
                  label={COPY.MEMBER}
                  choices={memberChoices}
                  value={memberOf(holding)}
                  onChange={(value) => choose(holding, value)}
                  noun={MEMBERS}
                />
              )}
            </fieldset>
          ))}
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
      {moved && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-text-muted">{COPY.HOLDINGS_MOVED}</p>
          <PageAction
            label={COPY.RELOAD_HOLDINGS}
            onClick={() => {
              clear();
              onReload();
            }}
          />
        </div>
      )}
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Preparing opening…"
          disabled={blocked || problems.length > 0}
        />
      </FormActions>
    </form>
  );
}
