import { Field, TextInput } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { Outcome } from '@components/Ledger';
import { FIELD_LIMITS, COMPANY_AUTHORITY_DECLARATION, COMPANY_AUTHORITY_DECLARATION_VERSION } from '@ledova/shared';
import { useAcceptInvitationForm } from './useAcceptInvitationForm';

export function AcceptInvitationForm({
  disabled,
  guard,
  onRecorded,
  onBusy,
}: {
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
}) {
  const { code, setCode, accepted, setAccepted, busy, error, setError, receipt, setReceipt, ready, send } =
    useAcceptInvitationForm({
      disabled,
      guard,
      onRecorded,
      onBusy,
    });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-text-muted">
        Enter the code the company gave you. Acceptance uses your signed-in account and the existing account, email and
        configured identity checks.
      </p>
      <Field label="Invitation code">
        <TextInput
          maxLength={FIELD_LIMITS.INVITATION_CODE}
          value={code}
          autoComplete="off"
          disabled={disabled || busy}
          onChange={(event) => {
            setCode(event.target.value);
            setAccepted(false);
            setError('');
            setReceipt('');
          }}
        />
      </Field>
      <p className="text-sm text-text-primary">{COMPANY_AUTHORITY_DECLARATION}</p>
      <p className="text-sm text-text-muted">
        Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Company information is provided by the company.
      </p>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={accepted}
          disabled={disabled || busy}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        Accept company authorisation declaration
      </label>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {receipt && <Outcome>{receipt}</Outcome>}
      <FormActions>
        <PageAction
          type="submit"
          label="Accept invitation"
          busy={busy}
          busyLabel="Accepting invitation…"
          primary
          disabled={disabled || !ready}
        />
      </FormActions>
    </form>
  );
}
