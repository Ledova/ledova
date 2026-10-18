import { AuthLayout, AuthHeader } from '@components/auth';
import { SIGNUP_PATHS } from '@utils/paths';
import { FinancialProfileForm } from './FinancialProfileForm';
import { LoadingState } from '@pages/signup/shared/LoadingState';
import { ErrorState } from '@pages/signup/shared/ErrorState';
import { useNavigate } from 'react-router-dom';
import { ChartBarIcon } from '@phosphor-icons/react';

import { useSignupFinancialProfile } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';

export default function SignupFinancialProfile() {
  const navigate = useNavigate();

  const { form, errors, generalError, isLoading, isSubmitting, userProfileId, setFieldValue, handleSubmit, retryLoad } =
    useSignupFinancialProfile();

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => {
      navigate(SIGNUP_PATHS.review);
    });
  };

  const handleBack = () => {
    navigate(SIGNUP_PATHS.userProfile);
  };

  if (isLoading) {
    return <LoadingState message="Loading financial profile..." />;
  }

  if (generalError && !userProfileId) {
    return (
      <ErrorState message="We encountered an issue while loading your financial profile data." onRetry={retryLoad} />
    );
  }

  if (!userProfileId) {
    return (
      <ErrorState
        title="Profile Not Found"
        message="Please complete your user profile before setting your financial profile."
        retryLabel="Go to Profile"
        onRetry={() => navigate(SIGNUP_PATHS.userProfile)}
      />
    );
  }

  return (
    <AuthLayout>
      <AuthHeader title="Financial Profile" icon={<ChartBarIcon size={ICON_MD} className="text-text-muted" />}>
        <p className="text-sm text-text-muted mt-1">AML/CTF compliance information</p>
      </AuthHeader>

      <FinancialProfileForm
        form={form}
        errors={errors}
        generalError={generalError}
        isSubmitting={isSubmitting}
        setFieldValue={setFieldValue}
        onSubmit={handleSubmitProfile}
        onBack={handleBack}
      />
    </AuthLayout>
  );
}
