import { useState } from 'react';
import type { FormErrors, SigninRequest, UserFriendlyError } from '../types';
import { readSignInError } from '../utils/errors';

export function useSignInForm() {
  const [form, setForm] = useState<SigninRequest>({ email: '', password: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const setFieldValue = (field: keyof SigninRequest, value: string) => {
    setForm({ ...form, [field]: value });
    setErrors({});
    setGeneralError(null);
  };

  const togglePassword = () => setShowPassword(!showPassword);

  const validateForm = (): boolean => {
    const problems: FormErrors = {};
    if (!form.email.trim()) problems.email = ['Email is required'];
    if (!form.password.trim()) problems.password = ['Password is required'];
    setErrors(problems);
    return Object.keys(problems).length === 0;
  };

  const showFailure = (error: unknown) => {
    setErrors({});
    setGeneralError(null);
    if (error && typeof error === 'object' && 'isUserFriendly' in error) {
      setGeneralError((error as unknown as UserFriendlyError).message);
      return;
    }
    const reading = readSignInError(error);
    if (reading.fieldErrors) setErrors(reading.fieldErrors as FormErrors);
    else setGeneralError(reading.generalError ?? null);
  };

  return {
    form,
    errors,
    generalError,
    setGeneralError,
    isLoading,
    setIsLoading,
    showPassword,
    setFieldValue,
    togglePassword,
    validateForm,
    showFailure,
  };
}
