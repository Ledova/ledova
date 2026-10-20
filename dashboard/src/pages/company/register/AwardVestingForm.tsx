import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
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
  const { shares, setShares, vestedOn, setVestedOn, setFile, busy, held, error, today, problem, submit } =
    useAwardVestingForm({ award, appointment, guard, blocked, onRecorded, onHeldChange, visible, canPrepare });
  if (!visible) return null;
  return (
    <form
      className="space-y-5 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-text-muted">
        Record the company-confirmed event for {award.name}; this creates no issued shares.
      </p>
      <fieldset
        disabled={busy || blocked || held || !canPrepare}
        className="grid gap-4 sm:grid-cols-2 [&>p]:sm:col-span-2"
      >
        <label className={LABEL}>
          {COPY.VESTING_SHARES}
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            value={shares}
            onChange={(event) => setShares(event.target.value.trim())}
          />
        </label>
        <label className={LABEL}>
          {COPY.VESTED_ON}
          <input
            className={FIELD_CLASS}
            type="date"
            max={today}
            value={vestedOn}
            onChange={(event) => setVestedOn(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.VESTING_DOCUMENT}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={FIELD_CLASS}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="text-sm text-text-muted">{COPY.VESTING_NOTE}</p>
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
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
          disabled={blocked || (!held && (!canPrepare || !!problem))}
        />
      </FormActions>
    </form>
  );
}
