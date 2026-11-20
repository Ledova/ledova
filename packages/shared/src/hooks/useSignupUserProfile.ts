import { USER_PROFILES_QUERY_KEY } from './useSignupReview';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { SIGNUP_NETWORK_ERROR } from '../constants/business/signup';
import { getUserProfiles, updateUserProfile } from '../services/users';
import type { FormErrors, UserProfileFormData, UserProfileFormValidation } from '../types';
import { describeFailure, readApiError } from '../utils/errors';
import { validateUserProfileField } from '../utils/user-validation';
import { isValidFullName } from '../utils/validation';
import { useApiClient } from './useApiClient';

const PROFILE_FIELDS = ['fullName'] as const;

const validateUserProfile = (form: UserProfileFormData): UserProfileFormValidation => {
  const fullName = {
    isValid: validateUserProfileField.fullName(form.fullName).isValid,
    isEmpty: form.fullName.trim().length === 0,
    hasValidFormat: isValidFullName(form.fullName),
  };

  return { fullName, isFormValid: fullName.isValid };
};

export function useSignupUserProfile() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UserProfileFormData>({ fullName: '' });

  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingProfileUuid, setExistingProfileUuid] = useState<string | null>(null);

  const formValidation = useMemo(() => {
    return validateUserProfile(form);
  }, [form]);

  const loadUserProfile = useCallback(async () => {
    try {
      const response = await getUserProfiles(apiClient);
      const profileData = response.data;

      if (profileData && profileData.results && profileData.count > 0) {
        const existingProfile = profileData.results[0]!;
        setExistingProfileUuid(existingProfile.uuid);
        setForm({ fullName: existingProfile.fullName || '' });
      }
    } catch (error) {
      console.error(`Failed to load profile data: ${describeFailure(error)}`);
      setGeneralError('Failed to load profile data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    loadUserProfile();
  }, [loadUserProfile]);

  const setFieldValue = (field: keyof UserProfileFormData, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (errors[field]) {
      const newErrors = { ...errors };
      delete newErrors[field];
      setErrors(newErrors);
    }
    setGeneralError('');
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!form.fullName.trim()) {
      newErrors.fullName = ['Full name is required'];
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (onSuccess: () => void) => {
    if (!validateForm()) {
      return;
    }

    if (!existingProfileUuid) {
      setGeneralError('User profile not found. Please contact support.');
      return;
    }

    setIsSubmitting(true);
    setGeneralError('');

    try {
      await updateUserProfile(apiClient, existingProfileUuid, { fullName: form.fullName.trim() });
      await queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY });

      onSuccess();
    } catch (error: unknown) {
      console.error(`User profile update failed: ${describeFailure(error)}`);
      const reading = readApiError(error, {
        fallback: 'Failed to save profile. Please try again.',
        displayedFields: PROFILE_FIELDS,
        unanswered: SIGNUP_NETWORK_ERROR,
      });
      setGeneralError(reading.generalError ?? '');
      setErrors(reading.fieldErrors ?? {});
    } finally {
      setIsSubmitting(false);
    }
  };

  const retryLoad = () => {
    setIsLoading(true);
    setGeneralError('');
    loadUserProfile();
  };

  return {
    form,
    errors,
    generalError,
    isLoading,
    isSubmitting,
    formValidation,
    setFieldValue,
    handleSubmit,
    retryLoad,
  };
}
