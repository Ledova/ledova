import { Link, useLocation } from 'react-router-dom';
import { EnvelopeIcon, LockIcon } from '@phosphor-icons/react';
import { FIELD_LIMITS } from '@ledova/shared';
import {
  AUTH_LINK_CLASS,
  AuthAlert,
  AuthCard,
  AuthField,
  AuthHeader,
  AuthInput,
  AuthLayout,
  AuthSubmit,
} from '@components/auth';
import { ErrorSummary } from '@components/ErrorSummary';
import { ICON_MD } from '@components/iconSizes';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';
import { SIGNIN_PATH } from '@utils/paths';
import { usePasswordReset } from './usePasswordReset';

function PasswordResetForm({ fragment }: { fragment: string }) {
  const reset = usePasswordReset(fragment);
  const reported = useFieldErrorSummary(reset.errors, ['email', 'newPassword', 'confirmPassword']);
  const email = reported.field('email');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await reset.submit();
    reported.reported();
  }

  return (
    <AuthLayout>
      <AuthHeader
        title={reset.complete ? 'Password reset' : reset.sent ? 'Check your email' : 'Reset password'}
        documentTitle="Reset password"
        icon={<LockIcon size={ICON_MD} className="text-text-muted" />}
      />
      <AuthCard>
        {reset.complete ? (
          <p role="status" className="text-sm text-text-body">
            Your password has been reset. Sign in with your new password.
          </p>
        ) : reset.sent ? (
          <div className="space-y-6">
            <p role="status" className="text-sm text-text-body">
              If an eligible account exists, a password reset email will be sent.
            </p>
            <button type="button" onClick={reset.requestNewLink} className={AUTH_LINK_CLASS}>
              Request another link
            </button>
          </div>
        ) : (
          <form noValidate onSubmit={submit} className="space-y-6">
            <ErrorSummary {...reported.summary} />
            {reset.generalError && <AuthAlert>{reset.generalError}</AuthAlert>}
            {reset.hasProof ? (
              (['newPassword', 'confirmPassword'] as const).map((key) => {
                const field = reported.field(key);
                return (
                  <AuthField
                    key={key}
                    id={field.id}
                    label={key === 'newPassword' ? 'New password' : 'Confirm new password'}
                    icon={<LockIcon size={ICON_MD} className="text-text-subtle" />}
                    error={field.error}
                  >
                    <AuthInput
                      type="password"
                      name={key}
                      autoComplete="new-password"
                      maxLength={FIELD_LIMITS.PASSWORD}
                      value={reset.form[key]}
                      onChange={(event) => reset.setFieldValue(key, event.target.value)}
                      required
                      invalid={!!field.error}
                      disabled={reset.isSubmitting}
                    />
                  </AuthField>
                );
              })
            ) : (
              <AuthField
                id={email.id}
                label="Email"
                icon={<EnvelopeIcon size={ICON_MD} className="text-text-subtle" />}
                error={email.error}
              >
                <AuthInput
                  type="email"
                  name="email"
                  autoComplete="email"
                  maxLength={FIELD_LIMITS.EMAIL}
                  value={reset.form.email}
                  onChange={(event) => reset.setFieldValue('email', event.target.value)}
                  required
                  invalid={!!email.error}
                  disabled={reset.isSubmitting}
                />
              </AuthField>
            )}
            <AuthSubmit busy={reset.isSubmitting} busyLabel={reset.hasProof ? 'Resetting password…' : 'Sending link…'}>
              {reset.hasProof ? 'Reset password' : 'Send reset link'}
            </AuthSubmit>
            {reset.hasProof && (
              <button
                type="button"
                onClick={reset.requestNewLink}
                disabled={reset.isSubmitting}
                className={AUTH_LINK_CLASS}
              >
                Request a new link
              </button>
            )}
          </form>
        )}
      </AuthCard>
      <div className="mt-6 text-center text-sm">
        <Link to={SIGNIN_PATH} className={AUTH_LINK_CLASS}>
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

export default function PasswordResetPage() {
  const location = useLocation();
  return <PasswordResetForm key={location.key} fragment={location.hash} />;
}
