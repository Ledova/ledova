import { Field, TextInput, FileField } from '@components/Field';
import { useTransferPreparation, type TransferFormProps } from './useTransferPreparation';

import { REGISTER_TRANSFER_COPY as COPY, type Person } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { formatShareCount } from '@ledova/shared';
import { PersonFields, PersonSelect } from '@pages/company/register/shared/PersonPicker';

function inClass(person: Person) {
  return person.awardOnly ? '' : `${formatShareCount(person.currentShares)} shares in this class`;
}

export function TransferForm({
  owner,
  guard,
  company,
  token,
  people,
  appointment,
  blocked,
  onRefused,
  initialFrom,
}: TransferFormProps) {
  const {
    today,
    draft,
    setFiles,
    busy,
    error,
    operation,
    setOperation,
    change,
    eligible,
    recipient,
    fresh,
    problems,
    submit,
    fields,
  } = useTransferPreparation({
    owner,
    guard,
    company,
    token,
    people,
    appointment,
    blocked,
    onRefused,
    initialFrom,
  });
  const checks = useErrorSummary(problems);

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (operation || checks.check()) void submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={busy || blocked} className="space-y-4">
        <PersonSelect
          {...checks.field('fromMember')}
          label={COPY.FROM}
          people={eligible.filter((member) => member.particularsRetained && BigInt(member.currentShares) > 0n)}
          value={draft.fromMember}
          onChange={(value) => change('fromMember', value)}
          allowNew={false}
          context={inClass}
        />
        <PersonSelect
          {...checks.field('toMember')}
          label={COPY.TO}
          people={eligible.filter((member) => member.member !== draft.fromMember)}
          value={draft.toMember}
          onChange={(value) => {
            change('toMember', value);
            const chosen = eligible.find((member) => member.member === value);
            if (chosen?.awardOnly || recipient?.awardOnly) {
              change('name', chosen?.awardOnly ? chosen.name : '');
              change('residentialAddress', chosen?.awardOnly ? chosen.residentialAddress : '');
            }
          }}
          context={inClass}
        />
        {fresh ? (
          <PersonFields
            name={draft.name}
            residentialAddress={draft.residentialAddress}
            onName={(value) => change('name', value)}
            onResidentialAddress={(value) => change('residentialAddress', value)}
            nameReadOnly={!!recipient?.awardOnly}
            addressReadOnly={!!recipient?.awardOnly}
            nameCheck={checks.field('name')}
            addressCheck={checks.field('residentialAddress')}
          />
        ) : (
          <p className="text-sm text-text-muted">
            The transfer retains the recipient’s recorded particulars. Check them in the preview.
          </p>
        )}
        {recipient?.lastCeasedOn && (
          <p className="text-sm text-text-muted">
            Last ceased in this class: {recipient.lastCeasedOn}. The same member ID is retained on return.
          </p>
        )}
        {fresh && draft.toMember !== 'new' && !recipient?.awardOnly && (
          <p className="text-sm text-text-muted">
            This member’s particulars passed the retention period. Supply their current particulars from the signed
            instrument, keeping their existing member ID.
          </p>
        )}
        {fields.map(([key, label, maxLength]) => (
          <Field key={key} {...checks.field(key)} label={label}>
            <TextInput
              type={key.endsWith('On') ? 'date' : 'text'}
              max={key.endsWith('On') ? today : undefined}
              inputMode={key === 'shares' ? 'numeric' : undefined}
              value={draft[key]}
              maxLength={maxLength}
              onChange={(event) => change(key, event.target.value)}
            />
          </Field>
        ))}
        <p className="text-sm text-text-muted">
          {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </p>
        {(['authority', 'instrument'] as const).map((kind) => (
          <FileField
            key={kind}
            {...checks.field(`${kind}Document`)}
            label={kind === 'authority' ? COPY.AUTHORITY_DOCUMENT : COPY.INSTRUMENT_DOCUMENT}
            onFile={(file) => {
              setOperation(null);
              setFiles((current) => ({ ...current, [kind]: file ?? undefined }));
            }}
          />
        ))}
        <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
      </fieldset>
      {operation && (
        <p className="text-sm text-text-muted">
          The unchanged retry will retrieve the original preparation, including its member IDs and retained documents.
          Edit a field to prepare a different transfer.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">
        If the preparation response is interrupted, retry with unchanged details to retrieve the same transfer.
      </p>
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Preparing transfer…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}
