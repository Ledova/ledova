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
import { Field, Label, Description } from '@headlessui/react';
import { WarningIcon } from '@phosphor-icons/react';
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
  onSubmit: (e: React.FormEvent) => void;
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

  return (
    <>
      <AuthCard>
        <form onSubmit={onSubmit} className="space-y-6">
          {generalError && (
            <div className={ERROR_BANNER_CLASS}>
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <WarningIcon size={ICON_MD} className="text-error-light" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-error-light" role="alert">
                    {generalError}
                  </p>
                </div>
              </div>
            </div>
          )}

          <CheckboxGroupField
            label="What is your primary source of funds?"
            value={form.sourceOfFunds}
            options={SOURCE_OF_FUNDS_OPTIONS}
            error={errors.sourceOfFunds}
            onChange={handleSourceOfFundsChange}
          />

          {form.sourceOfFunds.includes('other') && (
            <Field className="space-y-2">
              <Label className="block text-sm font-medium text-text-body">Please specify your source of funds</Label>
              <AuthInput
                type="text"
                name="sourceOfFundsOtherText"
                maxLength={FIELD_LIMITS.FINANCIAL_DETAIL}
                value={form.sourceOfFundsOtherText || ''}
                onChange={(e) => setFieldValue('sourceOfFundsOtherText', e.target.value)}
                className={authFieldClass(errors.sourceOfFundsOtherText)}
                placeholder="Enter details"
                disabled={isSubmitting}
              />
              {errors.sourceOfFundsOtherText && (
                <Description className="text-error-light text-xs mt-1" role="alert">
                  {errors.sourceOfFundsOtherText.join(' ')}
                </Description>
              )}
            </Field>
          )}

          <RadioGroupField
            label="What is your intended use of the platform?"
            value={form.intendedUse}
            options={INTENDED_USE_OPTIONS}
            error={errors.intendedUse}
            onChange={(value) => setFieldValue('intendedUse', value)}
          />

          {form.intendedUse === 'other' && (
            <Field className="space-y-2">
              <Label className="block text-sm font-medium text-text-body">Please specify your intended use</Label>
              <AuthInput
                type="text"
                name="intendedUseOtherText"
                maxLength={FIELD_LIMITS.FINANCIAL_DETAIL}
                value={form.intendedUseOtherText || ''}
                onChange={(e) => setFieldValue('intendedUseOtherText', e.target.value)}
                className={authFieldClass(errors.intendedUseOtherText)}
                placeholder="Enter details"
                disabled={isSubmitting}
              />
              {errors.intendedUseOtherText && (
                <Description className="text-error-light text-xs mt-1" role="alert">
                  {errors.intendedUseOtherText.join(' ')}
                </Description>
              )}
            </Field>
          )}

          <Field className="space-y-2">
            <Label className="block text-sm font-medium text-text-body">What is your occupation?</Label>
            <AuthInput
              type="text"
              name="occupation"
              maxLength={FIELD_LIMITS.FINANCIAL_DETAIL}
              value={form.occupation || ''}
              onChange={(e) => setFieldValue('occupation', e.target.value)}
              className={authFieldClass(errors.occupation)}
              placeholder="Enter your occupation"
              disabled={isSubmitting}
            />
            {errors.occupation && (
              <Description className="text-error-light text-xs mt-1" role="alert">
                {errors.occupation.join(' ')}
              </Description>
            )}
          </Field>

          <button type="submit" disabled={isSubmitting} onClick={onSubmit} className={AUTH_BUTTON_CLASS}>
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
