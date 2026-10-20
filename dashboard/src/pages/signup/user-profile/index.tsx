import { AuthLayout, AuthHeader } from '@components/auth';
import { SIGNUP_PATHS } from '@utils/paths';
import { useNavigate } from 'react-router-dom';
import { UserIcon } from '@phosphor-icons/react';
import { LoadingState } from '@pages/signup/shared/LoadingState';
import { ErrorState } from '@pages/signup/shared/ErrorState';
import { UserProfileForm } from './UserProfileForm';
import { useRole } from '@hooks/useRole';

import { useSignupUserProfile } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';

export default function SignupUserProfile() {
  const navigate = useNavigate();
  const { isCompany } = useRole();
  const {
    form,
    errors,
    generalError,
    isLoading,
    isSubmitting,
    formValidation,
    selectedCountry,
    countries,
    setFieldValue,
    handleCountryChange,
    handleSubmit,
    retryLoad,
  } = useSignupUserProfile();

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => {
      if (isCompany) {
        navigate(SIGNUP_PATHS.companyRegistration);
      } else {
        navigate(SIGNUP_PATHS.financialProfile);
      }
    });
  };

  const handleBack = () => {
    navigate(isCompany ? SIGNUP_PATHS.accountType : SIGNUP_PATHS.preScreening);
  };

  if (isLoading) {
    return <LoadingState message="Loading profile data…" />;
  }

  if (generalError && !form.fullName) {
    return <ErrorState message="We encountered an issue while loading your profile data." onRetry={retryLoad} />;
  }

  return (
    <AuthLayout>
      <AuthHeader title="Personal details" icon={<UserIcon size={ICON_MD} className="text-text-muted" />} />

      <UserProfileForm
        form={form}
        errors={errors}
        generalError={generalError}
        isSubmitting={isSubmitting}
        formValidation={formValidation}
        selectedCountry={selectedCountry}
        countries={countries}
        setFieldValue={setFieldValue}
        onCountryChange={handleCountryChange}
        onSubmit={handleSubmitProfile}
        onBack={handleBack}
      />
    </AuthLayout>
  );
}
