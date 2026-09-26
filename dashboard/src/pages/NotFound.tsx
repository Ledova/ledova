import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { DESTINATIONS, landingFor } from '@ledova/shared';
import { AuthLayout } from '@components/AuthLayout';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useSignupFinished } from '@hooks/useSignupFinished';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { SIGNUP_RESUMES_AT } from '../routes/signupRoutes';

function Missing({ to, label }: { to: string; label: string }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16 text-center">
      <h1 className="font-display text-3xl tracking-[-0.01em] text-text-primary">There is no page at this address</h1>
      <p className="mt-2 text-sm text-text-muted">It may be mistyped, or the page may have moved.</p>
      <Link
        to={to}
        className="mt-6 inline-block font-semibold text-brand-light transition-colors hover:text-brand-subtle"
      >
        {label}
      </Link>
    </div>
  );
}

export const NotFoundPage = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { isLoading: isProfileLoading } = useUserProfile();
  const { role, isLoading: isRoleLoading } = useRole();
  const framed = useSignupFinished();
  const inFrame = useContext(InSignedInFrame);

  if (isLoading || isProfileLoading || (framed && isRoleLoading) || framed !== inFrame) return null;

  if (!framed) {
    return (
      <AuthLayout>
        {isAuthenticated ? (
          <Missing to={SIGNUP_RESUMES_AT} label="Continue signing up" />
        ) : (
          <Missing to="/signin" label="Sign in" />
        )}
      </AuthLayout>
    );
  }

  const landing = landingFor(role);
  const title = Object.values(DESTINATIONS).find(({ path }) => path === landing)?.title;
  return <Missing to={landing} label={`Go to ${title}`} />;
};

export default NotFoundPage;
