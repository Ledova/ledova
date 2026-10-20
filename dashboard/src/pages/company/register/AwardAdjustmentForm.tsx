import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { FIELD_LIMITS, REGISTER_AWARD_COPY as COPY } from '@ledova/shared';
import { useAwardAdjustmentForm } from './useAwardAdjustmentForm';

export function AwardAdjustmentForm(props: Parameters<typeof useAwardAdjustmentForm>[0]) {
  const form = useAwardAdjustmentForm(props);
  if (!props.visible) return null;
  return (
    <form
      className="space-y-5 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <p className="text-sm text-text-muted">{props.vesting ? COPY.REVERSAL_NOTE : COPY.END_NOTE}</p>
      {props.vesting && <p className="text-sm">Original vesting: {props.vestingLabel}</p>}
      <fieldset
        disabled={form.busy || props.blocked || form.held || !props.canPrepare}
        className="grid gap-4 sm:grid-cols-2"
      >
        {props.vesting ? (
          <label className={LABEL}>
            {COPY.REVERSED_SHARES}
            <input
              className={FIELD_CLASS}
              inputMode="numeric"
              maxLength={FIELD_LIMITS.REGISTER_SHARES}
              value={form.reversedShares}
              onChange={(event) => form.setReversedShares(event.target.value.trim())}
            />
          </label>
        ) : (
          <>
            <label className={LABEL}>
              {COPY.END_UNVESTED}
              <input
                className={FIELD_CLASS}
                inputMode="numeric"
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                value={form.unvestedShares}
                onChange={(event) => form.setUnvestedShares(event.target.value.trim())}
              />
            </label>
            <label className={LABEL}>
              {COPY.END_VESTED}
              <input
                className={FIELD_CLASS}
                inputMode="numeric"
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                value={form.vestedShares}
                onChange={(event) => form.setVestedShares(event.target.value.trim())}
              />
            </label>
          </>
        )}
        <label className={LABEL}>
          {COPY.COMPANY_EVENT_ON}
          <input
            className={FIELD_CLASS}
            type="date"
            max={form.today}
            value={form.companyEventOn}
            onChange={(event) => form.setCompanyEventOn(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.REASON}
          <textarea
            className={FIELD_CLASS}
            maxLength={FIELD_LIMITS.REASON}
            value={form.reason}
            onChange={(event) => form.setReason(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          {COPY.ADJUSTMENT_DOCUMENT}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={FIELD_CLASS}
            onChange={(event) => form.setFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </fieldset>
      {form.problem && <p className="text-sm text-text-muted">{form.problem}</p>}
      {form.error && (
        <p role="alert" className="text-sm text-error-light">
          {form.error}
        </p>
      )}
      {form.held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={props.vesting ? COPY.REVERSE : COPY.END}
          busy={form.busy}
          busyLabel="Recording change…"
          disabled={props.blocked || (!form.held && (!props.canPrepare || !!form.problem))}
        />
      </FormActions>
    </form>
  );
}
