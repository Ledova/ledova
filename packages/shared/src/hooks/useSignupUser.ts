import { useState, useMemo } from 'react';

import { PASSWORD_VALIDATION } from '../constants/utilities';
import { signup } from '../services/auth';
import type { FormErrors, SignupRequest } from '../types';
import { describeFailure, readApiError } from '../utils/errors';
import { isNumericOnly, validatePassword } from '../utils/validation';
import { useApiClient } from './useApiClient';

export const SIGNUP_USER_FIELDS: readonly (keyof SignupRequest)[] = ['email', 'password'];

export function useSignupUser(rememberEmail: (email: string) => Promise<void> | void) {
  const apiClient = useApiClient();
  const [form, setForm] = useState<SignupRequest>({
    email: '',
    password: '',
    passwordConfirm: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const passwordValidation = useMemo(() => {
    if (!form.password) {
      return {
        isValid: true,
        lengthValid: true,
        notNumeric: true,
      };
    }
    return validatePassword(form.password, PASSWORD_VALIDATION.MIN_LENGTH);
  }, [form.password]);

  const setFieldValue = (field: keyof SignupRequest, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'password' ? { passwordConfirm: value } : {}),
    }));
    setErrors({});
    setGeneralError('');
  };

  const togglePassword = () => {
    setShowPassword(!showPassword);
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!form.email) {
      newErrors.email = ['Email is required'];
    }

    if (form.password.length < PASSWORD_VALIDATION.MIN_LENGTH) {
      newErrors.password = [`Password must be at least ${PASSWORD_VALIDATION.MIN_LENGTH} characters long`];
    }

    if (isNumericOnly(form.password)) {
      newErrors.password = [...(newErrors.password || []), 'Password cannot be entirely numeric'];
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (onSuccess: () => void) => {
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setGeneralError('');

    try {
      await signup(apiClient, {
        ...form,
        passwordConfirm: form.password,
      });

      await rememberEmail(form.email);

      onSuccess();
    } catch (error: unknown) {
      console.error(`Account creation failed: ${describeFailure(error)}`);
      if ((error as { response?: unknown })?.response) {
        const reading = readApiError(error, {
          fallback: 'Failed to create account. Please try again.',
          displayedFields: SIGNUP_USER_FIELDS,
        });
        setGeneralError(reading.generalError ?? '');
        setErrors(reading.fieldErrors ?? {});
      } else {
        setGeneralError('Network error. Please check your connection.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return {
    form,
    errors,
    generalError,
    isLoading,
    showPassword,
    passwordValidation,
    setFieldValue,
    togglePassword,
    handleSubmit,
  };
}
