import { useState } from 'react';

import { EMAIL_CONFIRMATION_VALIDATION } from '../constants/utilities';
import { resendVerificationCode, verifyEmail } from '../services/auth';
import type { FormErrors } from '../types';
import { describeFailure } from '../utils/errors';
import { formatVerificationToken, validateEmailConfirmation } from '../utils/validation';
import { useApiClient } from './useApiClient';

type Verification = Awaited<ReturnType<typeof verifyEmail>>;

export function useEmailVerification(email: string, onVerified: (verification: Verification) => Promise<void> | void) {
  const apiClient = useApiClient();
  const [verificationCode, setVerificationCode] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const handleVerify = async (onSuccess: () => void) => {
    const validation = validateEmailConfirmation(verificationCode, EMAIL_CONFIRMATION_VALIDATION.TOKEN_LENGTH);

    if (!validation.isValid) {
      setErrors({
        token: [`Please enter a valid ${EMAIL_CONFIRMATION_VALIDATION.TOKEN_LENGTH}-digit verification code`],
      });
      return;
    }

    setIsLoading(true);
    setGeneralError('');
    setErrors({});

    try {
      const verification = await verifyEmail(apiClient, {
        email,
        token: formatVerificationToken(verificationCode),
      });

      await onVerified(verification);

      onSuccess();
    } catch (error: unknown) {
      console.error(`Email verification failed: ${describeFailure(error)}`);
      const axiosError = error as { response?: { data?: unknown } };
      if (axiosError.response?.data) {
        const errorData = axiosError.response.data;
        if (typeof errorData === 'object' && !Array.isArray(errorData)) {
          setErrors(errorData as FormErrors);
          const firstError = Object.values(errorData).flat()[0];
          if (firstError) {
            setGeneralError(firstError as string);
          }
        } else if (typeof errorData === 'string') {
          setGeneralError(errorData);
        } else {
          setGeneralError('Invalid verification code. Please try again.');
        }
      } else {
        setGeneralError('Network error. Please check your connection.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    setSuccessMessage('');
    setGeneralError('');

    try {
      await resendVerificationCode(apiClient, { email });
      setSuccessMessage('Verification code sent! Please check your email.');
      setVerificationCode('');
    } catch (error) {
      console.error(`Failed to resend verification code: ${describeFailure(error)}`);
      setGeneralError('Failed to resend code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return {
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
  };
}
