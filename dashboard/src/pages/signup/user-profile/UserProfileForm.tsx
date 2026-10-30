import {
  ERROR_BANNER_CLASS,
  AuthCard,
  AuthInput,
  authFieldBorder,
  AuthDivider,
  authFieldClass,
  AuthSubmit,
} from '@components/auth';
import { Field, Label, Textarea, Description } from '@headlessui/react';
import { UserIcon, HouseIcon, PhoneIcon, WarningIcon, CalendarIcon } from '@phosphor-icons/react';
import { CountrySelector } from './CountrySelector';
import { FIELD_LIMITS, utcToday } from '@ledova/shared';
import type { FormErrors, UserProfileFormValidation, CountryData, UserProfileFormData } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

interface UserProfileFormProps {
  form: UserProfileFormData;
  errors: FormErrors;
  generalError: string;
  isSubmitting: boolean;
  formValidation: UserProfileFormValidation;
  selectedCountry: CountryData;
  countries: CountryData[];
  setFieldValue: (field: keyof UserProfileFormData, value: string) => void;
  onCountryChange: (country: CountryData) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onBack: () => void;
}

export function UserProfileForm({
  form,
  errors,
  generalError,
  isSubmitting,
  formValidation,
  selectedCountry,
  countries,
  setFieldValue,
  onSubmit,
  onBack,
  onCountryChange,
}: UserProfileFormProps) {
  const reported = useFieldErrorSummary(generalError ? {} : errors, [
    'fullName',
    'dateOfBirth',
    'phoneNumber',
    'residentialAddress',
  ]);
  const fullName = reported.field('fullName');
  const dateOfBirth = reported.field('dateOfBirth');
  const phoneNumber = reported.field('phoneNumber');
  const residentialAddress = reported.field('residentialAddress');
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

          <Field id={fullName.id} className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Full name</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type="text"
                name="fullName"
                maxLength={FIELD_LIMITS.PROFILE_NAME}
                value={form.fullName}
                onChange={(e) => setFieldValue('fullName', e.target.value)}
                className={authFieldClass(
                  (formValidation && !formValidation.fullName.isValid && form.fullName) || errors.fullName,
                  'pl-10 pr-3',
                )}
                placeholder="John Doe"
                required
                invalid={!!fullName.error}
                disabled={isSubmitting}
              />
            </div>
            {fullName.error && <Description className="text-error-light text-xs mt-1">{fullName.error}</Description>}
          </Field>

          <Field id={dateOfBirth.id} className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Date of birth</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <CalendarIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type="date"
                max={utcToday()}
                name="dateOfBirth"
                value={form.dateOfBirth || ''}
                onChange={(e) => setFieldValue('dateOfBirth', e.target.value)}
                className={authFieldClass(errors.dateOfBirth, 'pl-10 pr-3')}
                required
                invalid={!!dateOfBirth.error}
                disabled={isSubmitting}
              />
            </div>
            {dateOfBirth.error && (
              <Description className="text-error-light text-xs mt-1">{dateOfBirth.error}</Description>
            )}
          </Field>

          <Field id={phoneNumber.id} className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Phone number</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                <PhoneIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <div className="flex focus-within:ring-2 focus-within:ring-border-focus rounded-lg">
                {selectedCountry && countries && onCountryChange && (
                  <CountrySelector
                    countries={countries}
                    selectedCountry={selectedCountry}
                    onCountryChange={onCountryChange}
                    disabled={isSubmitting}
                  />
                )}
                <div className="relative flex-1">
                  <AuthInput
                    type="tel"
                    name="phoneNumber"
                    maxLength={FIELD_LIMITS.PHONE}
                    value={form.phoneNumber}
                    onChange={(e) => setFieldValue('phoneNumber', e.target.value)}
                    className={`w-full bg-surface-tertiary border ${authFieldBorder(
                      (formValidation && !formValidation.phoneNumber.isValid && form.phoneNumber) || errors.phoneNumber,
                    )} ${
                      selectedCountry ? 'rounded-r-lg border-l-0 pl-2' : 'rounded-lg pl-3'
                    } pr-3 py-3 text-text-primary placeholder-text-muted focus:outline-none transition-colors h-12`}
                    placeholder="416 123 456"
                    required
                    invalid={!!phoneNumber.error}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>
            {phoneNumber.error && (
              <Description className="text-error-light text-xs mt-1">{phoneNumber.error}</Description>
            )}
          </Field>

          <Field id={residentialAddress.id} className="space-y-1">
            <Label className="block text-sm font-medium text-text-body">Residential address</Label>
            <Description className="text-text-subtle text-xs">
              Include street number, city, state and postcode
            </Description>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 pt-3 flex items-start pointer-events-none">
                <HouseIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <Textarea
                name="residentialAddress"
                value={form.residentialAddress}
                onChange={(e) => setFieldValue('residentialAddress', e.target.value)}
                rows={3}
                className={`${authFieldClass(
                  (formValidation && !formValidation.residentialAddress.isValid && form.residentialAddress) ||
                    errors.residentialAddress,
                  'pl-10 pr-3',
                )} resize-none`}
                placeholder="123 Main Street&#10;Sydney NSW 2000"
                required
                invalid={!!residentialAddress.error}
                disabled={isSubmitting}
              />
            </div>
            {residentialAddress.error && (
              <Description className="text-error-light text-xs mt-1">{residentialAddress.error}</Description>
            )}
          </Field>

          <AuthSubmit busy={isSubmitting} busyLabel="Saving…" onClick={submit}>
            Continue
          </AuthSubmit>
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
