import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FIELD_LIMITS, REGISTER_AWARD_COPY as COPY } from '@ledova/shared';
import { useAwardAdjustmentForm } from './useAwardAdjustmentForm';

export function AwardAdjustmentForm(props: Parameters<typeof useAwardAdjustmentForm>[0]) {
  const form = useAwardAdjustmentForm(props);
  const checks = useErrorSummary(form.problems);
  if (!props.visible) return null;
  return (
    <form
      className="space-y-5 border-t border-border-subtle pt-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (form.held || checks.check()) void form.submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">{props.vesting ? COPY.REVERSAL_NOTE : COPY.END_NOTE}</p>
      {props.vesting && <p className="text-sm">Original vesting: {props.vestingLabel}</p>}
      <fieldset
        disabled={form.busy || props.blocked || form.held || !props.canPrepare}
        className="grid gap-4 sm:grid-cols-2"
      >
        {props.vesting ? (
          <Field {...checks.field('reversedShares')} label={COPY.REVERSED_SHARES}>
            <TextInput
              inputMode="numeric"
              maxLength={FIELD_LIMITS.REGISTER_SHARES}
              value={form.reversedShares}
              onChange={(event) => form.setReversedShares(event.target.value.trim())}
            />
          </Field>
        ) : (
          <>
            <Field {...checks.field('unvestedShares')} label={COPY.END_UNVESTED}>
              <TextInput
                inputMode="numeric"
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                value={form.unvestedShares}
                onChange={(event) => form.setUnvestedShares(event.target.value.trim())}
              />
            </Field>
            <Field {...checks.field('vestedShares')} label={COPY.END_VESTED}>
              <TextInput
                inputMode="numeric"
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                value={form.vestedShares}
                onChange={(event) => form.setVestedShares(event.target.value.trim())}
              />
            </Field>
          </>
        )}
        <Field {...checks.field('companyEventOn')} label={COPY.COMPANY_EVENT_ON}>
          <TextInput
            type="date"
            max={form.today}
            value={form.companyEventOn}
            onChange={(event) => form.setCompanyEventOn(event.target.value)}
          />
        </Field>
        <Field {...checks.field('reason')} label={COPY.REASON}>
          <TextArea
            maxLength={FIELD_LIMITS.REASON}
            value={form.reason}
            onChange={(event) => form.setReason(event.target.value)}
          />
        </Field>
        <FileField {...checks.field('file')} label={COPY.ADJUSTMENT_DOCUMENT} onFile={form.setFile} />
      </fieldset>
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
          disabled={props.blocked || (!form.held && !props.canPrepare)}
        />
      </FormActions>
    </form>
  );
}
