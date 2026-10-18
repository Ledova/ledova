import { AuthLayout, AuthHeader } from '@components/auth';
import { SIGNUP_PATHS } from '@utils/paths';
import { useNavigate } from 'react-router-dom';
import { BuildingsIcon } from '@phosphor-icons/react';
import { LoadingState } from '@pages/signup/shared/LoadingState';
import { ErrorState } from '@pages/signup/shared/ErrorState';
import { CompanyRegistrationForm } from './CompanyRegistrationForm';

import { useSignupCompanyRegistration } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';

export default function SignupCompanyRegistration() {
  const navigate = useNavigate();
  const {
    form,
    errors,
    generalError,
    loadError,
    hasLoadedForm,
    canSubmit,
    isLoading,
    isSubmitting,
    setFieldValue,
    handleSubmit,
    retryLoad,
  } = useSignupCompanyRegistration();

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => {
      navigate(SIGNUP_PATHS.review);
    });
  };

  const handleBack = () => {
    navigate(SIGNUP_PATHS.userProfile);
  };

  if (isLoading) {
    return <LoadingState message="Loading company data..." />;
  }

  if ((loadError && !hasLoadedForm) || (generalError && !form.name && !isSubmitting)) {
    return <ErrorState title="Unable to Load" message={loadError || generalError} onRetry={retryLoad} />;
  }

  return (
    <AuthLayout>
      <AuthHeader title="Company Details" icon={<BuildingsIcon size={ICON_MD} className="text-text-muted" />}>
        <p className="text-sm text-text-muted mt-1">
          Enter your company&apos;s basic information. Company information is provided by the company.
        </p>
      </AuthHeader>

      {loadError && (
        <div role="alert" className="mb-4 text-error-light">
          <p>{loadError}</p>
          <button type="button" onClick={retryLoad} className="mt-2 font-semibold underline">
            Try Again
          </button>
        </div>
      )}
      <CompanyRegistrationForm
        form={form}
        errors={errors}
        generalError={generalError}
        isSubmitting={isSubmitting}
        canSubmit={canSubmit}
        setFieldValue={setFieldValue}
        onSubmit={handleContinue}
        onBack={handleBack}
      />
    </AuthLayout>
  );
}
