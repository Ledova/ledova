import { AuthLayout, AUTH_BUTTON_CLASS, ERROR_BANNER_CLASS, AuthHeader, AuthCard, AuthInput } from '@components/auth';
import { SIGNUP_PATHS } from '@utils/paths';
import { clearSessionQueries } from '@utils/session';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Label, Description } from '@headlessui/react';
import { EnvelopeIcon, LockIcon, UserIcon, WarningIcon } from '@phosphor-icons/react';
import { FIELD_LIMITS, useSignupRestart } from '@ledova/shared';
import { useUserProfile } from '@hooks/useUserProfile';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

export function YourAccount() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userProfile } = useUserProfile();
  const {
    email,
    confirmEmail,
    currentPassword,
    changed,
    errors,
    generalError,
    isSubmitting,
    setEmail,
    setConfirmEmail,
    setCurrentPassword,
    handleSubmit,
  } = useSignupRestart(userProfile?.email ?? '', (address) => localStorage.setItem('signup_email', address));

  const reported = useFieldErrorSummary(errors, ['email', 'confirmEmail', 'currentPassword']);
  const emailField = reported.field('email');
  const confirmField = reported.field('confirmEmail');
  const passwordField = reported.field('currentPassword');
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(
      () => navigate(SIGNUP_PATHS.accountType),
      () => {
        clearSessionQueries(queryClient);
        navigate(SIGNUP_PATHS.emailConfirmation);
      },
    );
    reported.reported();
  };

  return (
    <AuthLayout>
      <AuthHeader title="Your account" icon={<UserIcon size={ICON_MD} className="text-text-muted" />}>
        <p className="text-sm text-text-muted mt-1 px-4">You are signed in with a verified email.</p>
      </AuthHeader>

      <AuthCard>
        <form noValidate onSubmit={handleContinue} className="space-y-6">
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

          <Field id={emailField.id} className="space-y-2">
            <Label className="block text-sm font-medium text-text-body">Email</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <EnvelopeIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type="email"
                name="email"
                maxLength={FIELD_LIMITS.EMAIL}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                invalid={!!emailField.error}
                disabled={isSubmitting}
              />
            </div>
            {emailField.error ? (
              <Description className="text-error-light text-sm mt-1">{emailField.error}</Description>
            ) : (
              !changed && (
                <Description className="text-text-muted text-sm mt-1">
                  Verified. Continue to keep your progress.
                </Description>
              )
            )}
          </Field>

          {changed && (
            <>
              <p className="text-sm text-text-body leading-relaxed">
                Changing your email starts signup again. We will send a code to the new address and clear your account
                type, eligibility answers, and personal and financial details. A company you have already saved stays
                with your account.
              </p>
              <Field id={confirmField.id} className="space-y-2">
                <Label className="block text-sm font-medium text-text-body">Confirm new email</Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <EnvelopeIcon size={ICON_MD} className="text-text-subtle" />
                  </div>
                  <AuthInput
                    type="email"
                    name="confirmEmail"
                    maxLength={FIELD_LIMITS.EMAIL}
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    invalid={!!confirmField.error}
                    disabled={isSubmitting}
                  />
                </div>
                {confirmField.error && (
                  <Description className="text-error-light text-sm mt-1">{confirmField.error}</Description>
                )}
              </Field>
              <Field id={passwordField.id} className="space-y-2">
                <Label className="block text-sm font-medium text-text-body">Current password</Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <LockIcon size={ICON_MD} className="text-text-subtle" />
                  </div>
                  <AuthInput
                    type="password"
                    name="currentPassword"
                    maxLength={FIELD_LIMITS.PASSWORD}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    invalid={!!passwordField.error}
                    disabled={isSubmitting}
                  />
                </div>
                {passwordField.error && (
                  <Description className="text-error-light text-sm mt-1">{passwordField.error}</Description>
                )}
              </Field>
            </>
          )}

          <button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Changing email…</span>
              </div>
            ) : changed ? (
              'Change email and start again'
            ) : (
              'Continue'
            )}
          </button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
