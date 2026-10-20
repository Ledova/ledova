import {
  AUTH_BUTTON_CLASS,
  ERROR_BANNER_CLASS,
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
} from '@components/auth';
import { Field, Label, Description, Select } from '@headlessui/react';
import { BuildingsIcon, WarningIcon, CaretDownIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';
import { COMPANY_TYPES } from '@pages/signup/shared/constants';

interface CompanyFormData {
  name: string;
  tradingName: string;
  companyType: string;
  acn: string;
  abn: string;
}

type FormErrors = Record<string, string[]>;

interface CompanyRegistrationFormProps {
  form: CompanyFormData;
  errors: FormErrors;
  generalError: string;
  isSubmitting: boolean;
  canSubmit: boolean;
  setFieldValue: (field: keyof CompanyFormData, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}

export function CompanyRegistrationForm({
  form,
  errors,
  generalError,
  isSubmitting,
  canSubmit,
  setFieldValue,
  onSubmit,
  onBack,
}: CompanyRegistrationFormProps) {
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

          <Field className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Registered company name *</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <BuildingsIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type="text"
                name="name"
                value={form.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('name', e.target.value)}
                className={`${authFieldClass(!!errors.name)} pl-10`}
                placeholder="Your Company Pty Ltd"
                required
                disabled={isSubmitting}
              />
            </div>
            {errors.name && (
              <Description className="text-error-light text-xs mt-1" role="alert">
                {errors.name.join(' ')}
              </Description>
            )}
          </Field>

          <Field className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Trading name (optional)</Label>
            <AuthInput
              type="text"
              name="tradingName"
              value={form.tradingName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('tradingName', e.target.value)}
              className={authFieldClass(!!errors.tradingName)}
              placeholder="Trading as…"
              disabled={isSubmitting}
            />
            {errors.tradingName && (
              <Description className="text-error-light text-xs mt-1" role="alert">
                {errors.tradingName.join(' ')}
              </Description>
            )}
          </Field>

          <Field className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Company type *</Label>
            <div className="relative">
              <Select
                name="companyType"
                value={form.companyType}
                onChange={(e) => setFieldValue('companyType', e.target.value)}
                disabled={isSubmitting}
                className={`${authFieldClass(!!errors.companyType)} appearance-none pr-10`}
              >
                {COMPANY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
              <CaretDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
            </div>
            {errors.companyType && (
              <Description className="text-error-light text-xs mt-1" role="alert">
                {errors.companyType.join(' ')}
              </Description>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field className="space-y-1">
              <Label className="block text-sm font-medium text-text-body">ACN *</Label>
              <AuthInput
                type="text"
                name="acn"
                value={form.acn}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('acn', e.target.value)}
                className={authFieldClass(!!errors.acn)}
                placeholder="123 456 789"
                required
                disabled={isSubmitting}
                maxLength={11}
              />
              {errors.acn && (
                <Description className="text-error-light text-xs mt-1" role="alert">
                  {errors.acn.join(' ')}
                </Description>
              )}
            </Field>

            <Field className="space-y-1">
              <Label className="block text-sm font-medium text-text-body">ABN (optional)</Label>
              <AuthInput
                type="text"
                name="abn"
                value={form.abn}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('abn', e.target.value)}
                className={authFieldClass(!!errors.abn)}
                placeholder="12 345 678 901"
                disabled={isSubmitting}
                maxLength={14}
              />
              {errors.abn && (
                <Description className="text-error-light text-xs mt-1" role="alert">
                  {errors.abn.join(' ')}
                </Description>
              )}
            </Field>
          </div>

          <button type="submit" disabled={isSubmitting || !canSubmit} className={AUTH_BUTTON_CLASS}>
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
      </div>
    </>
  );
}
