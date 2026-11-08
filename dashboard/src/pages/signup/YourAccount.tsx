import { AuthLayout, AuthHeader, AuthCard, AuthInput, AuthSubmit, AuthAlert, AuthField } from '@components/auth';
import { SIGNUP_PATHS } from '@utils/paths';
import { clearSessionQueries } from '@utils/session';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Description } from '@headlessui/react';
import { EnvelopeIcon, LockIcon, UserIcon } from '@phosphor-icons/react';
import { FIELD_LIMITS, useSignupRestart } from '@ledova/shared';
import { useUserProfile } from '@hooks/useUserProfile';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';

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
          {generalError && <AuthAlert>{generalError}</AuthAlert>}

          <AuthField
            id={emailField.id}
            label="Email"
            icon={<EnvelopeIcon size={ICON_MD} className="text-text-subtle" />}
            error={emailField.error}
            below={
              !emailField.error &&
              !changed && (
                <Description className="text-text-muted text-sm mt-1">
                  Verified. Continue to keep your progress.
                </Description>
              )
            }
          >
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
          </AuthField>

          {changed && (
            <>
              <p className="text-sm text-text-body leading-relaxed">
                Changing your email starts signup again. We will send a code to the new address and clear your saved
                signup answers and personal details. A company you have already saved stays with your account.
              </p>
              <AuthField
                id={confirmField.id}
                label="Confirm new email"
                icon={<EnvelopeIcon size={ICON_MD} className="text-text-subtle" />}
                error={confirmField.error}
              >
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
              </AuthField>
              <AuthField
                id={passwordField.id}
                label="Current password"
                icon={<LockIcon size={ICON_MD} className="text-text-subtle" />}
                error={passwordField.error}
              >
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
              </AuthField>
            </>
          )}

          <AuthSubmit busy={isSubmitting} busyLabel="Changing email…">
            {changed ? 'Change email and start again' : 'Continue'}
          </AuthSubmit>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
