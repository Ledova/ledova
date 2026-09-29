import { useState, useEffect } from 'react';

import { createFinancialProfile, getFinancialProfiles, updateFinancialProfile } from '../services/financialProfile';
import { getUserProfiles } from '../services/users';
import type { CreateFinancialProfile, FinancialProfileFormState, FormErrors } from '../types';
import { describeFailure, readApiError } from '../utils/errors';
import { sourceOfFundsChoices } from '../utils/formatting-labels';
import { useApiClient } from './useApiClient';

export const FINANCIAL_PROFILE_FIELDS: readonly (keyof FinancialProfileFormState)[] = [
  'sourceOfFunds',
  'sourceOfFundsOtherText',
  'intendedUse',
  'intendedUseOtherText',
  'occupation',
];

const fieldsShown = (form: FinancialProfileFormState) =>
  FINANCIAL_PROFILE_FIELDS.filter(
    (field) =>
      (field !== 'sourceOfFundsOtherText' || form.sourceOfFunds.includes('other')) &&
      (field !== 'intendedUseOtherText' || form.intendedUse === 'other'),
  );

export function useSignupFinancialProfile() {
  const apiClient = useApiClient();
  const [form, setForm] = useState<FinancialProfileFormState>({
    userProfileId: '',
    occupation: '',
    sourceOfFunds: [],
    sourceOfFundsOtherText: '',
    intendedUse: '',
    intendedUseOtherText: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingProfileUuid, setExistingProfileUuid] = useState<string | null>(null);
  const [userProfileId, setUserProfileId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const profileResponse = await getUserProfiles(apiClient);
      const profileData = profileResponse.data;

      if (profileData && profileData.results && profileData.count > 0) {
        const userProfile = profileData.results[0]!;
        const profileUuid = userProfile.uuid;
        setUserProfileId(profileUuid);
        setForm((prev) => ({ ...prev, userProfileId: profileUuid }));

        const financialProfileResponse = await getFinancialProfiles(apiClient);
        const financialProfileData = financialProfileResponse.data;

        if (financialProfileData && financialProfileData.results && financialProfileData.count > 0) {
          const existingProfile = financialProfileData.results[0]!;
          setExistingProfileUuid(existingProfile.uuid);

          setForm({
            userProfileId: profileUuid,
            occupation: existingProfile.occupation || '',
            sourceOfFunds: sourceOfFundsChoices(existingProfile.sourceOfFunds),
            sourceOfFundsOtherText: existingProfile.sourceOfFundsOtherText || '',
            intendedUse: existingProfile.intendedUse || '',
            intendedUseOtherText: existingProfile.intendedUseOtherText || '',
          });
        }
      } else {
        setGeneralError('Please complete your user profile first.');
      }
    } catch (error) {
      console.error(`Failed to load financial profile: ${describeFailure(error)}`);
      setGeneralError('Failed to load profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const setFieldValue = <Field extends keyof FinancialProfileFormState>(
    field: Field,
    value: FinancialProfileFormState[Field],
  ) => {
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

  const toggleSourceOfFunds = (value: string) => {
    const currentSources = form.sourceOfFunds;
    if (currentSources.includes(value)) {
      setFieldValue(
        'sourceOfFunds',
        currentSources.filter((s) => s !== value),
      );
    } else {
      setFieldValue('sourceOfFunds', [...currentSources, value]);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (form.occupation && (form.occupation.length < 2 || form.occupation.length > 200)) {
      newErrors.occupation = ['Occupation must be between 2 and 200 characters'];
    }

    if (form.sourceOfFunds.includes('other') && !form.sourceOfFundsOtherText?.trim()) {
      newErrors.sourceOfFundsOtherText = ['Please specify your source of funds'];
    }

    if (form.intendedUse === 'other' && !form.intendedUseOtherText?.trim()) {
      newErrors.intendedUseOtherText = ['Please specify your intended use'];
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (onSuccess: () => void) => {
    if (!validateForm()) {
      return;
    }

    if (!userProfileId) {
      setGeneralError('User profile not found. Please complete your profile first.');
      return;
    }

    setIsSubmitting(true);
    setGeneralError('');

    try {
      const apiPayload: CreateFinancialProfile = {
        occupation: form.occupation || null,
        sourceOfFunds: form.sourceOfFunds,
        sourceOfFundsOtherText: form.sourceOfFundsOtherText || null,
        intendedUse: form.intendedUse || null,
        intendedUseOtherText: form.intendedUseOtherText || null,
      };

      if (existingProfileUuid) {
        await updateFinancialProfile(apiClient, existingProfileUuid, apiPayload);
      } else {
        await createFinancialProfile(apiClient, apiPayload);
      }

      onSuccess();
    } catch (error: unknown) {
      console.error(`Financial profile update failed: ${describeFailure(error)}`);
      if ((error as { response?: unknown })?.response) {
        const reading = readApiError(error, {
          fallback: 'Failed to save profile. Please try again.',
          displayedFields: fieldsShown(form),
        });
        setGeneralError(reading.generalError ?? '');
        setErrors(reading.fieldErrors ?? {});
      } else {
        setGeneralError('Network error. Please check your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const retryLoad = () => {
    setIsLoading(true);
    setGeneralError('');
    loadData();
  };

  return {
    form,
    errors,
    generalError,
    isLoading,
    isSubmitting,
    existingProfileUuid,
    userProfileId,
    setFieldValue,
    toggleSourceOfFunds,
    handleSubmit,
    retryLoad,
  };
}
