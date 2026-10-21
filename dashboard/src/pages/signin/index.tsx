import { FIELD_LIMITS } from '@ledova/shared';
import {
  AuthLayout,
  AUTH_BUTTON_CLASS,
  ERROR_BANNER_CLASS,
  AuthHeader,
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
} from '@components/auth';
import { ROOT_PATH, SIGNUP_PATH } from '@utils/paths';
import { Link, useNavigate } from 'react-router-dom';
import { useSignIn } from './useSignIn';
import { Field, Label, Description } from '@headlessui/react';
import { EyeIcon, EyeSlashIcon, EnvelopeIcon, LockIcon, WarningIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';

function SignInPage() {
  const navigate = useNavigate();
  const { form, errors, generalError, isLoading, showPassword, setFieldValue, togglePassword, handleSubmit } =
    useSignIn();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => navigate(ROOT_PATH));
  };

  return (
    <AuthLayout>
      <AuthHeader title="Welcome back" icon={<LockIcon size={ICON_MD} className="text-text-muted" />} />

      <AuthCard>
        <form onSubmit={handleSignIn} className="space-y-6">
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
                maxLength={FIELD_LIMITS.EMAIL}
                value={form.email}
                onChange={(e) => setFieldValue('email', e.target.value)}
                placeholder="your@email.com"
                required
                disabled={isLoading}
              />
            </div>
            {errors.email && !generalError && errors.email.length > 0 && (
              <Description className="text-error-light text-sm mt-1" role="alert">
                {errors.email.join(' ')}
              </Description>
            )}
          </Field>

          <Field className="space-y-2">
            <Label className="block text-sm font-medium text-text-body">Password</Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <LockIcon size={ICON_MD} className="text-text-subtle" />
              </div>
              <AuthInput
                type={showPassword ? 'text' : 'password'}
                name="password"
                maxLength={FIELD_LIMITS.PASSWORD}
                value={form.password}
                onChange={(e) => setFieldValue('password', e.target.value)}
                className={authFieldClass(false, 'pl-10 pr-12', true, 'focus:ring-brand-mid')}
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={togglePassword}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-subtle hover:text-text-body transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                disabled={isLoading}
              >
                {showPassword ? <EyeSlashIcon size={ICON_MD} /> : <EyeIcon size={ICON_MD} />}
              </button>
            </div>
            {errors.password && !generalError && errors.password.length > 0 && (
              <Description className="text-error-light text-sm mt-1" role="alert">
                {errors.password.join(' ')}
              </Description>
            )}
          </Field>

          <button type="submit" disabled={isLoading} className={AUTH_BUTTON_CLASS}>
            {isLoading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Signing in…</span>
              </div>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          Don&apos;t have an account?{' '}
          <Link to={SIGNUP_PATH} className="font-semibold text-brand-light hover:text-brand-subtle transition-colors">
            Get started
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export default SignInPage;
