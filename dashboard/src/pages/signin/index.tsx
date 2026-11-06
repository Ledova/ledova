import { FIELD_LIMITS } from '@ledova/shared';
import {
  AuthLayout,
  AuthHeader,
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
  AuthSubmit,
  AuthAlert,
  AuthField,
  AUTH_LINK_CLASS,
} from '@components/auth';
import { ROOT_PATH, SIGNUP_PATH } from '@utils/paths';
import { Link, useNavigate } from 'react-router-dom';
import { useSignIn } from './useSignIn';
import { EyeIcon, EyeSlashIcon, EnvelopeIcon, LockIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';

function SignInPage() {
  const navigate = useNavigate();
  const { form, errors, generalError, isLoading, showPassword, setFieldValue, togglePassword, handleSubmit } =
    useSignIn();
  const reported = useFieldErrorSummary(generalError ? {} : errors, ['email', 'password']);
  const email = reported.field('email');
  const password = reported.field('password');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => navigate(ROOT_PATH));
    reported.reported();
  };

  return (
    <AuthLayout>
      <AuthHeader
        title="Welcome back"
        documentTitle="Sign in"
        icon={<LockIcon size={ICON_MD} className="text-text-muted" />}
      />

      <AuthCard>
        <form noValidate onSubmit={handleSignIn} className="space-y-6">
          <ErrorSummary {...reported.summary} />
          {generalError && <AuthAlert>{generalError}</AuthAlert>}

          <AuthField
            id={email.id}
            label="Email"
            icon={<EnvelopeIcon size={ICON_MD} className="text-text-subtle" />}
            error={email.error}
          >
            <AuthInput
              type="email"
              name="email"
              maxLength={FIELD_LIMITS.EMAIL}
              value={form.email}
              onChange={(e) => setFieldValue('email', e.target.value)}
              placeholder="your@email.com"
              required
              invalid={!!email.error}
              disabled={isLoading}
            />
          </AuthField>

          <AuthField
            id={password.id}
            label="Password"
            icon={<LockIcon size={ICON_MD} className="text-text-subtle" />}
            error={password.error}
          >
            <AuthInput
              type={showPassword ? 'text' : 'password'}
              name="password"
              maxLength={FIELD_LIMITS.PASSWORD}
              value={form.password}
              onChange={(e) => setFieldValue('password', e.target.value)}
              className={authFieldClass(false, 'pl-10 pr-12', true, 'focus:ring-brand-mid')}
              placeholder="••••••••"
              required
              invalid={!!password.error}
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
          </AuthField>

          <AuthSubmit busy={isLoading} busyLabel="Signing in…">
            Sign in
          </AuthSubmit>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          Don&apos;t have an account?{' '}
          <Link to={SIGNUP_PATH} className={AUTH_LINK_CLASS}>
            Get started
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export default SignInPage;
