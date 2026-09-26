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

function Missing({ heading: Heading, to, label }: { heading: 'h1' | 'h2'; to: string; label: string }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16 text-center">
      <Heading className="font-display text-3xl tracking-[-0.01em] text-text-primary">
        There is no page at this address
      </Heading>
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
          <Missing heading="h1" to={SIGNUP_RESUMES_AT} label="Continue signing up" />
        ) : (
          <Missing heading="h1" to="/signin" label="Sign in" />
        )}
      </AuthLayout>
    );
  }

  const landing = landingFor(role);
  const title = Object.values(DESTINATIONS).find(({ path }) => path === landing)?.title;
  return <Missing heading="h2" to={landing} label={`Go to ${title}`} />;
};

export default NotFoundPage;
