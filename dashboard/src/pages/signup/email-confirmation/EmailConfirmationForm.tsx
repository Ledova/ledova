import { FIELD_LIMITS } from '@ledova/shared';
import { ERROR_BANNER_CLASS, AuthCard, AuthInput, AuthDivider, authFieldClass, AuthSubmit } from '@components/auth';
import { Field, Label, Description } from '@headlessui/react';
import { KeyIcon, WarningIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { FormErrors } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

interface EmailConfirmationFormProps {
  verificationCode: string;
  errors: FormErrors;
  generalError: string;
  successMessage: string;
  isLoading: boolean;
  isResending: boolean;
  setVerificationCode: (code: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
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
  const reported = useFieldErrorSummary(generalError ? {} : errors, ['token']);
  const token = reported.field('token');
  return (
    <>
      <AuthCard>
        <form noValidate onSubmit={(event) => void onSubmit(event).then(reported.reported)} className="space-y-6">
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

          <Field id={token.id} className="space-y-2">
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
                className={authFieldClass(errors.token, 'pl-10 pr-3', false)}
                placeholder="Enter verification code"
                required
                invalid={!!token.error}
                disabled={isLoading}
                maxLength={FIELD_LIMITS.VERIFICATION_CODE}
              />
            </div>
            {token.error && <Description className="text-error-light text-sm mt-1">{token.error}</Description>}
          </Field>

          <AuthSubmit busy={isLoading} busyLabel="Verifying…">
            Verify
          </AuthSubmit>
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
