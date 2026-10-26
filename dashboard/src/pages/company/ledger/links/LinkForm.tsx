import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Choices } from '@components/Choices';
import { useLinkPreparation, type LinkFormProps, COPY } from './useLinkPreparation';

import { FIELD_LIMITS, type RegisterCorrectionAuthority } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { SearchSelect } from '@components/SearchSelect';

import { WalletStatus } from '@pages/company/ledger/shared/WalletStatus';

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
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-medium text-text-primary">Company authority</legend>
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
          <div className="sm:col-span-2">
            <FileField
              {...checks.field('file')}
              label={COPY.AUTHORITY_DOCUMENT}
              hint={COPY.AUTHORITY_DOCUMENT_NOTE}
              showUploadHint={false}
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
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}
