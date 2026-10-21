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

export function AwardVestingForm({
  award,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  award: RegisterAward;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
}) {
  const { shares, setShares, vestedOn, setVestedOn, setFile, busy, held, error, today, problems, submit } =
    useAwardVestingForm({ award, appointment, guard, blocked, onRecorded, onHeldChange, visible, canPrepare });
  const checks = useErrorSummary(problems);
  if (!visible) return null;
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
      <p className="text-sm text-text-muted">
        Record the company-confirmed event for {award.name}; this creates no issued shares.
      </p>
      <fieldset
        disabled={busy || blocked || held || !canPrepare}
        className="grid gap-4 sm:grid-cols-2 [&>p]:sm:col-span-2"
      >
        <Field {...checks.field('shares')} label={COPY.VESTING_SHARES}>
          <TextInput
            inputMode="numeric"
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </Field>
        <Field {...checks.field('vestedOn')} label={COPY.VESTED_ON}>
          <TextInput type="date" max={today} value={vestedOn} onChange={(event) => setVestedOn(event.target.value)} />
        </Field>
        <FileField {...checks.field('file')} label={COPY.VESTING_DOCUMENT} onFile={setFile} />
        <p className="text-sm text-text-muted">{COPY.VESTING_NOTE}</p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.VEST}
          busy={busy}
          busyLabel="Recording vesting…"
          disabled={blocked || (!held && !canPrepare)}
        />
      </FormActions>
    </form>
  );
}
