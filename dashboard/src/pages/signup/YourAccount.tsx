import { AuthLayout, AUTH_BUTTON_CLASS, ERROR_BANNER_CLASS, AuthHeader, AuthCard, AuthInput } from '@components/auth';
import { SIGNUP_PATHS } from '@utils/paths';
import { clearSessionQueries } from '@utils/session';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Label, Description } from '@headlessui/react';
import { EnvelopeIcon, LockIcon, UserIcon, WarningIcon } from '@phosphor-icons/react';
import { useSignupRestart } from '@ledova/shared';
import { useUserProfile } from '@hooks/useUserProfile';
import { ICON_MD } from '@components/iconSizes';

export function YourAccount() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userProfile } = useUserProfile();
  const {
    email,
    currentPassword,
    changed,
    errors,
    generalError,
    isSubmitting,
    setEmail,
    setCurrentPassword,
    handleSubmit,
  } = useSignupRestart(userProfile?.email ?? '', (address) => localStorage.setItem('signup_email', address));

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(
      () => navigate(SIGNUP_PATHS.accountType),
      () => {
        clearSessionQueries(queryClient);
        navigate(SIGNUP_PATHS.emailConfirmation);
      },
    );
  };

  return (
    <AuthLayout>
      <AuthHeader title="Your Account" icon={<UserIcon size={ICON_MD} className="text-text-muted" />}>
        <p className="text-sm text-text-muted mt-1 px-4">You are signed in with a verified email.</p>
      </AuthHeader>

      <AuthCard>
        <form onSubmit={handleContinue} className="space-y-6">
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

          <Field className="space-y-2">
            <Label className="block text-sm font-medium text-text-body">Email</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <EnvelopeIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={isSubmitting}
              />
            </div>
            {errors.email && errors.email.length > 0 ? (
              <Description className="text-error-light text-sm mt-1" role="alert">
                {errors.email.join(' ')}
              </Description>
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
              <Field className="space-y-2">
                <Label className="block text-sm font-medium text-text-body">Current password</Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <LockIcon size={ICON_MD} className="text-text-subtle" />
                  </div>
                  <AuthInput
                    type="password"
                    name="currentPassword"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={isSubmitting}
                  />
                </div>
                {errors.currentPassword && errors.currentPassword.length > 0 && (
                  <Description className="text-error-light text-sm mt-1" role="alert">
                    {errors.currentPassword.join(' ')}
                  </Description>
                )}
              </Field>
            </>
          )}

          <button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Changing email...</span>
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
