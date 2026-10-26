import { CheckboxField, Field, TextInput } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { Outcome } from '@components/Ledger';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  FIELD_LIMITS,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  INVITATION_CODE_PROBLEM,
  isInvitationCode,
} from '@ledova/shared';
import { useAcceptInvitationForm } from './useAcceptInvitationForm';

export function AcceptInvitationForm({
  disabled,
  guard,
  onRecorded,
  onBusy,
  onCancel,
}: {
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
}) {
  const { code, setCode, accepted, setAccepted, busy, error, setError, receipt, setReceipt, send } =
    useAcceptInvitationForm({
      disabled,
      guard,
      onRecorded,
      onBusy,
    });
  const checks = useErrorSummary({
    code: !isInvitationCode(code) && INVITATION_CODE_PROBLEM,
    accepted: !accepted && 'Accept the company authorisation declaration.',
  });
  const changeCode = (value: string) => {
    setCode(value);
    setAccepted(false);
    setError('');
    setReceipt('');
  };
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (checks.check()) void send();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">
        Enter the code the company gave you. Acceptance uses your signed-in account and the existing account, email and
        configured identity checks.
      </p>
      <Field {...checks.field('code')} label="Invitation code">
        <TextInput
          maxLength={FIELD_LIMITS.INVITATION_CODE}
          value={code}
          autoComplete="off"
          disabled={disabled || busy}
          onChange={(event) => changeCode(event.target.value.trim())}
          onPaste={(event) => {
            event.preventDefault();
            changeCode(event.clipboardData.getData('text').trim().slice(0, FIELD_LIMITS.INVITATION_CODE));
          }}
        />
      </Field>
      <p className="text-sm text-text-primary">{COMPANY_AUTHORITY_DECLARATION}</p>
      <p className="text-sm text-text-muted">
        Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Company information is provided by the company.
      </p>
      <CheckboxField
        {...checks.field('accepted')}
        label="Accept company authorisation declaration"
        checked={accepted}
        disabled={disabled || busy}
        onChange={(event) => setAccepted(event.target.checked)}
      />
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <Outcome>{receipt}</Outcome>
      <FormActions>
        <PageAction label={receipt ? 'Done' : 'Cancel'} disabled={busy} onClick={onCancel} />
        <PageAction
          type="submit"
          label="Accept invitation"
          busy={busy}
          busyLabel="Accepting invitation…"
          primary
          disabled={disabled}
        />
      </FormActions>
    </form>
  );
}
