import { Field, TextInput, FileField } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  FIELD_LIMITS,
  REGISTER_AWARD_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterAward,
} from '@ledova/shared';
import { useAwardVestingForm } from './useAwardVestingForm';
import { Failure } from '@components/Ledger';

export function AwardVestingForm({
  award,
  appointment,
  guard,
  blocked,
  onRecorded,
  onCancel,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  award: RegisterAward;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onCancel: () => void;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
}) {
  const { shares, setShares, vestedOn, setVestedOn, setFile, busy, held, error, today, problems, submit } =
    useAwardVestingForm({ award, appointment, guard, blocked, onRecorded, onHeldChange, visible, canPrepare });
  const checks = useErrorSummary(problems);
  const cancel = (
    <PageAction
      label="Cancel"
      context={visible ? `vesting for ${award.recipientName}` : 'vesting recovery'}
      disabled={busy || blocked || held}
      onClick={onCancel}
    />
  );
  if (!visible) return <FormActions>{cancel}</FormActions>;
  return (
    <form
      className="space-y-5 border-t border-border-subtle pt-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (held || checks.check()) void submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <fieldset
        disabled={busy || blocked || held || !canPrepare}
        className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <legend className="pb-4 text-base font-medium">Record vesting</legend>
        <Field {...checks.field('shares')} label="Shares in this event">
          <TextInput
            inputMode="numeric"
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </Field>
        <Field {...checks.field('vestedOn')} label="Vesting date">
          <TextInput type="date" max={today} value={vestedOn} onChange={(event) => setVestedOn(event.target.value)} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-1">
          <FileField {...checks.field('file')} label="Document" onFile={setFile} />
        </div>
      </fieldset>
      <Failure>{error}</Failure>
      {held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <FormActions>
        {cancel}
        <PageAction
          type="submit"
          primary
          label="Record vesting"
          busy={busy}
          busyLabel="Recording vesting…"
          disabled={blocked || (!held && !canPrepare)}
        />
      </FormActions>
    </form>
  );
}
