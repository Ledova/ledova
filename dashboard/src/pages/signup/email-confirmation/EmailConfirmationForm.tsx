import { FIELD_LIMITS } from '@ledova/shared';
import {
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
  AuthSubmit,
  AuthAlert,
  AuthBack,
  AuthField,
  AUTH_LINK_CLASS,
} from '@components/auth';
import { KeyIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { FormErrors } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';

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
          {generalError && <AuthAlert>{generalError}</AuthAlert>}

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

          <AuthField
            id={token.id}
            label="Verification code"
            icon={<KeyIcon size={ICON_MD} className="text-text-subtle" />}
            error={token.error}
          >
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
          </AuthField>

          <AuthSubmit busy={isLoading} busyLabel="Verifying…">
            Verify
          </AuthSubmit>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center space-y-3">
        <p className="text-sm text-text-subtle">
          Didn&apos;t receive the code?{' '}
          <button type="button" onClick={onResendCode} disabled={isResending || isLoading} className={AUTH_LINK_CLASS}>
            {isResending ? 'Sending…' : 'Resend'}
          </button>
        </p>
        <p className="text-sm text-text-subtle">
          <AuthBack onClick={onBack} disabled={isLoading || isResending} />
        </p>
      </div>
    </>
  );
}
