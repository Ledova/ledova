import {
  AuthLayout,
  ERROR_BANNER_CLASS,
  AuthHeader,
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
  AuthSubmit,
} from '@components/auth';
import { SIGNIN_PATH, SIGNUP_PATHS } from '@utils/paths';
import { Link, useNavigate } from 'react-router-dom';
import { Field, Label, Description } from '@headlessui/react';
import { EyeIcon, EyeSlashIcon, EnvelopeIcon, LockIcon, UserIcon, WarningIcon } from '@phosphor-icons/react';

import { FIELD_LIMITS, useAuth, useSignupUser } from '@ledova/shared';
import { YourAccount } from './YourAccount';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import { Failure } from '@components/Ledger';

function emailRefusal(sentence: string) {
  if (!/already registered/i.test(sentence)) return sentence;
  const lead = sentence.split('Please')[0].trim().replace(/\.$/, '');
  return (
    <>
      {`${lead}. Please `}
      <Link to={SIGNIN_PATH} className="underline hover:text-error-light">
        sign in
      </Link>
      {' or use a different email.'}
    </>
  );
}

export default function SignupUser() {
  const navigate = useNavigate();
  const {
    form,
    errors,
    generalError,
    isLoading,
    showPassword,
    passwordValidation,
    setFieldValue,
    togglePassword,
    handleSubmit,
  } = useSignupUser((email) => localStorage.setItem('signup_email', email));

  const { isAuthenticated } = useAuth();
  const reported = useFieldErrorSummary(generalError ? {} : errors, ['email', 'password']);
  const email = reported.field('email');
  const password = reported.field('password');

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => {
      navigate(SIGNUP_PATHS.emailConfirmation);
    });
    reported.reported();
  };

  if (isAuthenticated) return <YourAccount />;

  return (
    <AuthLayout>
      <AuthHeader title="Create your account" icon={<UserIcon size={ICON_MD} className="text-text-muted" />} />

      <AuthCard>
        <form noValidate onSubmit={handleSignUp} className="space-y-6">
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

          <Field id={email.id} className="space-y-2">
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
                invalid={!!email.error}
                disabled={isLoading}
              />
            </div>
            {email.error && (
              <Description className="text-error-light text-sm mt-1">
                {errors.email.map((error, index) => (
                  <span key={index}>
                    {index > 0 && ' '}
                    {emailRefusal(error)}
                  </span>
                ))}
              </Description>
            )}
          </Field>

          <Field id={password.id} className="space-y-3">
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
                className={authFieldClass(
                  (!passwordValidation.lengthValid || !passwordValidation.notNumeric) && form.password,
                  'pl-10 pr-12',
                  false,
                  'focus:ring-brand-mid',
                )}
                placeholder="••••••••"
                minLength={8}
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
            </div>

            <div>
              <p className="text-xs font-medium text-text-body mb-2">Password must:</p>
              <ul className="space-y-1">
                <li className="flex items-center space-x-2 text-xs">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      form.password && !passwordValidation.lengthValid ? 'bg-error-light' : 'bg-text-subtle'
                    }`}
                  />
                  <span
                    className={
                      form.password && !passwordValidation.lengthValid ? 'text-error-light' : 'text-text-muted'
                    }
                  >
                    Be at least 8 characters long
                  </span>
                </li>
                <li className="flex items-center space-x-2 text-xs">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      form.password && !passwordValidation.notNumeric ? 'bg-error-light' : 'bg-text-subtle'
                    }`}
                  />
                  <span
                    className={form.password && !passwordValidation.notNumeric ? 'text-error-light' : 'text-text-muted'}
                  >
                    Not be entirely numeric
                  </span>
                </li>
              </ul>
            </div>

            {password.error && <Description className="text-error-light text-sm mt-1">{password.error}</Description>}
          </Field>

          <AuthSubmit busy={isLoading} busyLabel="Creating account…">
            Continue
          </AuthSubmit>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          Already have an account?{' '}
          <Link to={SIGNIN_PATH} className="font-semibold text-brand-light hover:text-brand-subtle transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
