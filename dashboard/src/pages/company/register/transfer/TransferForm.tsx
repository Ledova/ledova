import { useTransferPreparation, type TransferFormProps } from './useTransferPreparation';

import { REGISTER_TRANSFER_COPY as COPY } from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';

export function TransferForm({
  owner,
  guard,
  company,
  token,
  members,
  appointment,
  blocked,
  onRefused,
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
    problem,
    submit,
    fields,
  } = useTransferPreparation({ owner, guard, company, token, members, appointment, blocked, onRefused });

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy || blocked} className="space-y-4">
        <label className={LABEL}>
          {COPY.FROM}
          <select
            className={FIELD_CLASS}
            value={draft.fromMember}
            onChange={(event) => change('fromMember', event.target.value)}
          >
            <option value="">Choose the transferor</option>
            {eligible
              .filter((member) => member.particularsRetained && BigInt(member.currentShares) > 0n)
              .map((member) => (
                <option key={member.member} value={member.member}>
                  {member.name} · {member.currentShares} shares · {member.member}
                </option>
              ))}
          </select>
        </label>
        <label className={LABEL}>
          {COPY.TO}
          <select
            className={FIELD_CLASS}
            value={draft.toMember}
            onChange={(event) => change('toMember', event.target.value)}
          >
            <option value="new">New member</option>
            {eligible
              .filter((member) => member.member !== draft.fromMember)
              .map((member) => (
                <option key={member.member} value={member.member}>
                  {member.name || 'Recorded member'} · {member.currentShares} shares in this class · {member.member}
                </option>
              ))}
          </select>
        </label>
        {fresh ? (
          <>
            <label className={LABEL}>
              {COPY.NAME}
              <input
                className={FIELD_CLASS}
                value={draft.name}
                maxLength={255}
                onChange={(event) => change('name', event.target.value)}
              />
            </label>
            <label className={LABEL}>
              {COPY.ADDRESS}
              <input
                className={FIELD_CLASS}
                value={draft.residentialAddress}
                maxLength={1000}
                onChange={(event) => change('residentialAddress', event.target.value)}
              />
            </label>
          </>
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
        {fresh && draft.toMember !== 'new' && (
          <p className="text-sm text-text-muted">
            This member’s particulars passed the retention period. Supply their current particulars from the signed
            instrument, keeping their existing member ID.
          </p>
        )}
        {fields.map(([key, label, maxLength]) => (
          <label key={key} className={LABEL}>
            {label}
            <input
              className={FIELD_CLASS}
              type={key === 'signedOn' || key === 'lodgedOn' ? 'date' : 'text'}
              max={key === 'signedOn' || key === 'lodgedOn' ? today : undefined}
              inputMode={key === 'shares' ? 'numeric' : undefined}
              value={draft[key]}
              maxLength={maxLength}
              onChange={(event) => change(key, event.target.value)}
            />
          </label>
        ))}
        <p className="text-sm text-text-muted">
          {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </p>
        {(['authority', 'instrument'] as const).map((kind) => (
          <label key={kind} className={LABEL}>
            {kind === 'authority' ? COPY.AUTHORITY_DOCUMENT : COPY.INSTRUMENT_DOCUMENT}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className={FIELD_CLASS}
              onChange={(event) => {
                setOperation(null);
                setFiles((current) => ({ ...current, [kind]: event.target.files?.[0] }));
              }}
            />
          </label>
        ))}
        <p className="text-sm text-text-muted">PDF or image, max 10 MB each. {COPY.PROVIDED_BY_COMPANY}</p>
      </fieldset>
      {operation ? (
        <p className="text-sm text-text-muted">
          The unchanged retry will retrieve the original preparation, including its member IDs and retained documents.
          Edit a field to prepare a different transfer.
        </p>
      ) : (
        problem && <p className="text-sm text-text-muted">{problem}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">
        If the preparation response is interrupted, retry with unchanged details to retrieve the same transfer.
      </p>
      <div className="flex justify-end border-t border-border-subtle pt-4">
        <PageAction
          primary
          label={busy ? 'Preparing transfer…' : COPY.SUBMIT}
          disabled={busy || blocked || (!operation && !!problem)}
          onClick={() => void submit()}
        />
      </div>
    </form>
  );
}
