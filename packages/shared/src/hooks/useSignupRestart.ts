import { useState } from 'react';
import { SIGNUP_NETWORK_ERROR } from '../constants/business/signup';
import { restartSignup } from '../services/auth';
import type { FormErrors, SignupRestartRequest } from '../types';
import { describeFailure, readApiError } from '../utils/errors';
import { useApiClient } from './useApiClient';

export const SIGNUP_RESTART_FIELDS: readonly (keyof SignupRestartRequest)[] = ['email', 'currentPassword'];

const sameAddress = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

export function useSignupRestart(verifiedEmail: string, rememberEmail: (email: string) => Promise<void> | void) {
  const apiClient = useApiClient();
  const [editedEmail, setEditedEmail] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const email = editedEmail ?? verifiedEmail;
  const changed = !sameAddress(email, verifiedEmail);

  const clearErrors = () => {
    setErrors({});
    setGeneralError('');
  };

  const handleSubmit = async (onKept: () => void, onRestarted: () => Promise<void> | void) => {
    if (!changed) {
      onKept();
      return;
    }
    const address = email.trim();
    if (!address) {
      setErrors({ email: ['Email is required'] });
      return;
    }
    if (!currentPassword) {
      setErrors({ currentPassword: ['Enter your current password to change your email'] });
      return;
    }
    setIsSubmitting(true);
    clearErrors();
    try {
      await restartSignup(apiClient, { email: address, currentPassword });
      await rememberEmail(address);
      await onRestarted();
    } catch (error: unknown) {
      console.error(`Signup restart failed: ${describeFailure(error)}`);
      const reading = readApiError(error, {
        fallback: 'We could not change your email. Please try again.',
        displayedFields: SIGNUP_RESTART_FIELDS,
        unanswered: SIGNUP_NETWORK_ERROR,
      });
      setGeneralError(reading.generalError ?? '');
      setErrors(reading.fieldErrors ?? {});
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    email,
    currentPassword,
    changed,
    errors,
    generalError,
    isSubmitting,
    setEmail: (value: string) => {
      setEditedEmail(value);
      clearErrors();
    },
    setCurrentPassword: (value: string) => {
      setCurrentPassword(value);
      clearErrors();
    },
    handleSubmit,
  };
}
