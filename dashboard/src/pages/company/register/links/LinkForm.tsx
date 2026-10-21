import { Field, TextArea, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { useLinkPreparation, type LinkFormProps, COPY } from './useLinkPreparation';

import { FIELD_LIMITS, type RegisterCorrectionAuthority } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { SearchSelect } from '@components/SearchSelect';

import { WalletStatus } from '@pages/company/register/shared/WalletStatus';

const EVIDENCE = 'application/pdf,image/png,image/jpeg';

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

const MEMBERS = ['member', 'members'] as const;

export function LinkForm({
  owner,
  guard,
  company,
  wallets,
  registers,
  appointment,
  blocked,
  onRefused,
  onConflict,
  onMissing,
}: LinkFormProps) {
  const { draft, busy, error, ordered, reset, memberOf, labels, problems, update, choose, submit } = useLinkPreparation(
    { owner, guard, company, wallets, registers, appointment, blocked, onRefused, onConflict, onMissing },
  );
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
            <Field label={COPY.APPROVING_DIRECTOR}>
              <TextInput
                value={draft.director}
                maxLength={FIELD_LIMITS.DIRECTOR}
                onChange={(event) => update({ director: event.target.value })}
              />
            </Field>
          )}
          <Field label={COPY.AUTHORITY_REFERENCE}>
            <TextInput
              value={draft.reference}
              maxLength={FIELD_LIMITS.REFERENCE}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </Field>
          <Field label={COPY.REASON}>
            <TextArea
              rows={3}
              value={draft.reason}
              maxLength={FIELD_LIMITS.REASON}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </Field>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">{COPY.WALLETS}</legend>
          <p className="text-sm text-text-muted">{COPY.MAPPING_NOTE}</p>
          <p className="text-sm text-text-muted">{COPY.STATUS_NOTE}</p>
          {reset && (
            <p role="status" className="text-sm text-text-primary">
              {COPY.CHOICES_RESET}
            </p>
          )}
          {ordered.map((wallet) => (
            <fieldset key={wallet.address} className="space-y-2 border-t border-border-subtle pt-3">
              <legend className="break-all text-sm text-text-primary">{wallet.address}</legend>
              <p className="text-xs text-text-muted">{COPY.WAITING(wallet.waiting)}</p>
              <WalletStatus wallet={wallet} />
              <SearchSelect
                label={COPY.MEMBER}
                choices={memberChoices}
                value={memberOf(wallet.address.toLowerCase())}
                onChange={(value) => choose(wallet.address.toLowerCase(), value)}
                noun={MEMBERS}
              />
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
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Preparing wallet link…"
          disabled={blocked || problems.length > 0}
        />
      </FormActions>
    </form>
  );
}
