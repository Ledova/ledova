import { COMPANY_TYPES, FIELD_LIMITS } from '@ledova/shared';
import {
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
  AuthSubmit,
  AuthAlert,
  AuthBack,
  AuthField,
} from '@components/auth';
import { Select } from '@headlessui/react';
import { BuildingsIcon, CaretDownIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';

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
  onSubmit: (e: React.FormEvent) => Promise<void>;
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
  const reported = useFieldErrorSummary(errors, ['name', 'tradingName', 'companyType', 'acn', 'abn']);
  const submit = (event: React.FormEvent) => void onSubmit(event).then(reported.reported);
  return (
    <>
      <AuthCard>
        <form noValidate onSubmit={submit} className="space-y-6">
          <ErrorSummary {...reported.summary} />
          {generalError && <AuthAlert>{generalError}</AuthAlert>}

          <AuthField
            id={reported.field('name').id}
            label="Registered company name"
            icon={<BuildingsIcon size={ICON_MD} className="text-text-subtle" />}
            error={errors.name?.join(' ')}
          >
            <AuthInput
              type="text"
              name="name"
              maxLength={FIELD_LIMITS.COMPANY_NAME}
              value={form.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('name', e.target.value)}
              className={`${authFieldClass(!!errors.name)} pl-10`}
              invalid={!!errors.name}
              placeholder="Your Company Pty Ltd"
              required
              disabled={isSubmitting}
            />
          </AuthField>

          <AuthField
            id={reported.field('tradingName').id}
            label="Trading name (optional)"
            error={errors.tradingName?.join(' ')}
          >
            <AuthInput
              type="text"
              name="tradingName"
              maxLength={FIELD_LIMITS.COMPANY_NAME}
              value={form.tradingName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('tradingName', e.target.value)}
              className={authFieldClass(!!errors.tradingName)}
              invalid={!!errors.tradingName}
              placeholder="Trading as…"
              disabled={isSubmitting}
            />
          </AuthField>

          <AuthField id={reported.field('companyType').id} label="Company type" error={errors.companyType?.join(' ')}>
            <div className="relative">
              <Select
                name="companyType"
                value={form.companyType}
                onChange={(e) => setFieldValue('companyType', e.target.value)}
                disabled={isSubmitting}
                className={`${authFieldClass(!!errors.companyType)} appearance-none pr-10`}
                invalid={!!errors.companyType}
              >
                {COMPANY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
              <CaretDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
            </div>
          </AuthField>

          <div className="grid grid-cols-2 gap-4">
            <AuthField id={reported.field('acn').id} label="ACN" error={errors.acn?.join(' ')}>
              <AuthInput
                type="text"
                name="acn"
                value={form.acn}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('acn', e.target.value)}
                className={authFieldClass(!!errors.acn)}
                invalid={!!errors.acn}
                placeholder="123 456 789"
                required
                disabled={isSubmitting}
                maxLength={FIELD_LIMITS.ACN}
              />
            </AuthField>

            <AuthField id={reported.field('abn').id} label="ABN (optional)" error={errors.abn?.join(' ')}>
              <AuthInput
                type="text"
                name="abn"
                value={form.abn}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValue('abn', e.target.value)}
                className={authFieldClass(!!errors.abn)}
                invalid={!!errors.abn}
                placeholder="12 345 678 901"
                disabled={isSubmitting}
                maxLength={FIELD_LIMITS.ABN}
              />
            </AuthField>
          </div>

          <AuthSubmit busy={isSubmitting} busyLabel="Saving…" disabled={isSubmitting || !canSubmit}>
            Continue
          </AuthSubmit>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          <AuthBack onClick={onBack} disabled={isSubmitting} />
        </p>
      </div>
    </>
  );
}
