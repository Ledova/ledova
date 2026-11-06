import {
  AuthCard,
  AuthInput,
  authFieldClass,
  AuthDivider,
  AuthSubmit,
  AuthAlert,
  AuthBack,
  AuthField,
} from '@components/auth';
import React from 'react';
import {
  FIELD_LIMITS,
  FormErrors,
  FinancialProfileFormState,
  SOURCE_OF_FUNDS_OPTIONS,
  INTENDED_USE_OPTIONS,
} from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import RadioGroupField from './RadioGroupField';
import CheckboxGroupField from './CheckboxGroupField';

interface FinancialProfileFormProps {
  form: FinancialProfileFormState;
  errors: FormErrors;
  generalError: string;
  isSubmitting: boolean;
  setFieldValue: <Field extends keyof FinancialProfileFormState>(
    field: Field,
    value: FinancialProfileFormState[Field],
  ) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onBack?: () => void;
}

export function FinancialProfileForm({
  form,
  errors,
  generalError,
  isSubmitting,
  setFieldValue,
  onSubmit,
  onBack,
}: FinancialProfileFormProps) {
  const handleSourceOfFundsChange = (values: string[]) => {
    setFieldValue('sourceOfFunds', values);
  };
  const reported = useFieldErrorSummary(errors, [
    'sourceOfFunds',
    'sourceOfFundsOtherText',
    'intendedUse',
    'intendedUseOtherText',
    'occupation',
  ]);
  const funds = reported.field('sourceOfFunds');
  const fundsOther = reported.field('sourceOfFundsOtherText');
  const use = reported.field('intendedUse');
  const useOther = reported.field('intendedUseOtherText');
  const occupation = reported.field('occupation');
  const submit = (event: React.FormEvent) => void onSubmit(event).then(reported.reported);

  return (
    <>
      <AuthCard>
        <form noValidate onSubmit={submit} className="space-y-6">
          <ErrorSummary {...reported.summary} />
          {generalError && <AuthAlert>{generalError}</AuthAlert>}

          <CheckboxGroupField
            id={funds.id}
            label="What is your primary source of funds?"
            value={form.sourceOfFunds}
            options={SOURCE_OF_FUNDS_OPTIONS}
            error={errors.sourceOfFunds}
            onChange={handleSourceOfFundsChange}
          />

          {form.sourceOfFunds.includes('other') && (
            <AuthField id={fundsOther.id} label="Please specify your source of funds" error={fundsOther.error}>
              <AuthInput
                type="text"
                name="sourceOfFundsOtherText"
                maxLength={FIELD_LIMITS.FINANCIAL_DETAIL}
                value={form.sourceOfFundsOtherText || ''}
                onChange={(e) => setFieldValue('sourceOfFundsOtherText', e.target.value)}
                className={authFieldClass(errors.sourceOfFundsOtherText)}
                placeholder="Enter details"
                invalid={!!fundsOther.error}
                disabled={isSubmitting}
              />
            </AuthField>
          )}

          <RadioGroupField
            id={use.id}
            label="What is your intended use of the platform?"
            value={form.intendedUse}
            options={INTENDED_USE_OPTIONS}
            error={errors.intendedUse}
            onChange={(value) => setFieldValue('intendedUse', value)}
          />

          {form.intendedUse === 'other' && (
            <AuthField id={useOther.id} label="Please specify your intended use" error={useOther.error}>
              <AuthInput
                type="text"
                name="intendedUseOtherText"
                maxLength={FIELD_LIMITS.FINANCIAL_DETAIL}
                value={form.intendedUseOtherText || ''}
                onChange={(e) => setFieldValue('intendedUseOtherText', e.target.value)}
                className={authFieldClass(errors.intendedUseOtherText)}
                placeholder="Enter details"
                invalid={!!useOther.error}
                disabled={isSubmitting}
              />
            </AuthField>
          )}

          <AuthField id={occupation.id} label="What is your occupation?" error={occupation.error}>
            <AuthInput
              type="text"
              name="occupation"
              maxLength={FIELD_LIMITS.FINANCIAL_DETAIL}
              value={form.occupation || ''}
              onChange={(e) => setFieldValue('occupation', e.target.value)}
              className={authFieldClass(errors.occupation)}
              placeholder="Enter your occupation"
              invalid={!!occupation.error}
              disabled={isSubmitting}
            />
          </AuthField>

          <AuthSubmit busy={isSubmitting} busyLabel="Saving…">
            Continue
          </AuthSubmit>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        {onBack && (
          <p className="text-sm text-text-subtle">
            <AuthBack onClick={onBack} disabled={isSubmitting} />
          </p>
        )}
      </div>
    </>
  );
}
