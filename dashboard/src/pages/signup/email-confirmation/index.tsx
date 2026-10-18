import { AuthLayout, AuthHeader } from '@components/auth';
import { SIGNUP_PATHS, SIGNUP_PATH } from '@utils/paths';
import { useNavigate } from 'react-router-dom';
import { EnvelopeIcon } from '@phosphor-icons/react';
import { EmailConfirmationForm } from './EmailConfirmationForm';
import { useSignupEmailConfirmation } from './useSignupEmailConfirmation';
import { ICON_MD } from '@components/iconSizes';

export default function SignupEmailConfirmation() {
  const navigate = useNavigate();
  const {
    email,
    verificationCode,
    errors,
    generalError,
    successMessage,
    isLoading,
    isResending,
    setVerificationCode,
    handleVerify,
    handleResend,
  } = useSignupEmailConfirmation();

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleVerify(() => {
      navigate(SIGNUP_PATHS.accountType);
    });
  };

  const handleBack = () => {
    navigate(SIGNUP_PATH);
  };

  return (
    <AuthLayout>
      <AuthHeader title="Verify Your Email" icon={<EnvelopeIcon size={ICON_MD} className="text-text-muted" />}>
        {email && <p className="text-sm text-text-muted mt-2">Code sent to {email}</p>}
      </AuthHeader>

      <EmailConfirmationForm
        verificationCode={verificationCode}
        errors={errors}
        generalError={generalError}
        successMessage={successMessage}
        isLoading={isLoading}
        isResending={isResending}
        setVerificationCode={setVerificationCode}
        onSubmit={handleSubmitVerification}
        onResendCode={handleResend}
        onBack={handleBack}
      />
    </AuthLayout>
  );
}
