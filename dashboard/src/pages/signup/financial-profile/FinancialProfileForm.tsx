import {
  AUTH_BUTTON_CLASS,
  ERROR_BANNER_CLASS,
  AuthCard,
  AuthInput,
  authFieldClass,
  AuthDivider,
} from '@components/auth';
import React from 'react';
import {
  FIELD_LIMITS,
  FormErrors,
  FinancialProfileFormState,
  SOURCE_OF_FUNDS_OPTIONS,
  INTENDED_USE_OPTIONS,
} from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import { Field, Label, Description } from '@headlessui/react';
import { WarningIcon } from '@phosphor-icons/react';
import RadioGroupField from './RadioGroupField';
import CheckboxGroupField from './CheckboxGroupField';
import { Failure } from '@components/Ledger';

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
          {generalError && (
            <div className={ERROR_BANNER_CLASS}>
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <WarningIcon size={ICON_MD} className="text-error-light" />
                </div>
                <div className="ml-3">
                  <Failure>{generalError}</Failure>
                </div>
              </div>
            </div>
          )}

          <CheckboxGroupField
            id={funds.id}
            label="What is your primary source of funds?"
            value={form.sourceOfFunds}
            options={SOURCE_OF_FUNDS_OPTIONS}
            error={errors.sourceOfFunds}
            onChange={handleSourceOfFundsChange}
          />

          {form.sourceOfFunds.includes('other') && (
            <Field id={fundsOther.id} className="space-y-2">
              <Label className="block text-sm font-medium text-text-body">Please specify your source of funds</Label>
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
              {fundsOther.error && (
                <Description className="text-error-light text-xs mt-1">{fundsOther.error}</Description>
              )}
            </Field>
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
            <Field id={useOther.id} className="space-y-2">
              <Label className="block text-sm font-medium text-text-body">Please specify your intended use</Label>
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
              {useOther.error && <Description className="text-error-light text-xs mt-1">{useOther.error}</Description>}
            </Field>
          )}

          <Field id={occupation.id} className="space-y-2">
            <Label className="block text-sm font-medium text-text-body">What is your occupation?</Label>
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
            {occupation.error && (
              <Description className="text-error-light text-xs mt-1">{occupation.error}</Description>
            )}
          </Field>

          <button type="submit" disabled={isSubmitting} onClick={submit} className={AUTH_BUTTON_CLASS}>
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Saving…</span>
              </div>
            ) : (
              'Continue'
            )}
          </button>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        {onBack && (
          <p className="text-sm text-text-subtle">
            <button
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
              className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Go back
            </button>
          </p>
        )}
      </div>
    </>
  );
}
