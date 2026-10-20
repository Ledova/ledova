import { FIELD_LIMITS } from '@ledova/shared';
import {
  AUTH_BUTTON_CLASS,
  ERROR_BANNER_CLASS,
  AuthCard,
  AuthInput,
  authFieldBorder,
  AuthDivider,
} from '@components/auth';
import { Field, Label, Description } from '@headlessui/react';
import { KeyIcon, WarningIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { FormErrors } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';

interface EmailConfirmationFormProps {
  verificationCode: string;
  errors: FormErrors;
  generalError: string;
  successMessage: string;
  isLoading: boolean;
  isResending: boolean;
  setVerificationCode: (code: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onResendCode: () => void;
  onBack: () => void;
}

export function EmailConfirmationForm({
  verificationCode,
  errors,
  generalError,
  successMessage,
  isLoading,
  isResending,
  setVerificationCode,
  onSubmit,
  onResendCode,
  onBack,
}: EmailConfirmationFormProps) {
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

          {successMessage && (
            <div className="border border-success-dark rounded-lg p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <CheckCircleIcon size={ICON_MD} className="text-success-light" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-success-light" role="status">
                    {successMessage}
                  </p>
                </div>
              </div>
            </div>
          )}

          <Field className="space-y-2">
            <Label className="block text-sm font-medium text-text-body">Verification code</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <KeyIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type="text"
                name="token"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                className={`w-full bg-surface-tertiary border ${authFieldBorder(
                  errors.token,
                  false,
                )} rounded-lg pl-10 pr-3 py-3 text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:border-transparent transition-colors`}
                placeholder="Enter verification code"
                required
                disabled={isLoading}
                maxLength={FIELD_LIMITS.VERIFICATION_CODE}
              />
            </div>
            {errors.token && !generalError && (
              <Description className="text-error-light text-sm mt-1" role="alert">
                {errors.token.join(' ')}
              </Description>
            )}
          </Field>

          <button type="submit" disabled={isLoading} className={AUTH_BUTTON_CLASS}>
            {isLoading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Verifying…</span>
              </div>
            ) : (
              'Verify'
            )}
          </button>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center space-y-3">
        <p className="text-sm text-text-subtle">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            onClick={onResendCode}
            disabled={isResending || isLoading}
            className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResending ? 'Sending…' : 'Resend'}
          </button>
        </p>
        <p className="text-sm text-text-subtle">
          <button
            type="button"
            onClick={onBack}
            disabled={isLoading || isResending}
            className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Go back
          </button>
        </p>
      </div>
    </>
  );
}
