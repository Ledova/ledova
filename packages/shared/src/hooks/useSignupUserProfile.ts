import { USER_PROFILES_QUERY_KEY } from './useSignupReview';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { DATE_OF_BIRTH_IN_FUTURE, SIGNUP_NETWORK_ERROR } from '../constants/business/signup';
import { COUNTRIES, type CountryData } from '../constants/countries';
import { getUserProfiles, updateUserProfile } from '../services/users';
import type { FormErrors, UserProfileFormData, UserProfileFormValidation } from '../types';
import { isCalendarDate, utcToday } from '../utils/date';
import { describeFailure, readApiError } from '../utils/errors';
import { cleanPhoneNumber, formatPhoneForDisplay } from '../utils/phoneFormatting';
import { validateUserProfileField } from '../utils/user-validation';
import { isValidFullName, isValidPhoneFormat } from '../utils/validation';
import { useApiClient } from './useApiClient';

const DEFAULT_COUNTRY = COUNTRIES[0]!;

export const USER_PROFILE_FIELDS = ['fullName', 'dateOfBirth', 'residentialAddress', 'phoneNumber'] as const;

type ProfileField = (typeof USER_PROFILE_FIELDS)[number];

const validateUserProfile = (form: UserProfileFormData, fields: readonly ProfileField[]): UserProfileFormValidation => {
  const fullNameValidation = validateUserProfileField.fullName(form.fullName);
  const phoneNumberValidation = validateUserProfileField.phoneNumber(form.phoneNumber);
  const residentialAddressValidation = validateUserProfileField.residentialAddress(form.residentialAddress);

  const fullName = {
    isValid: fullNameValidation.isValid,
    isEmpty: form.fullName.trim().length === 0,
    hasValidFormat: isValidFullName(form.fullName),
  };

  const phoneNumber = {
    isValid: phoneNumberValidation.isValid,
    isEmpty: form.phoneNumber.trim().length === 0,
    hasValidFormat: isValidPhoneFormat(form.phoneNumber),
  };

  const residentialAddress = {
    isValid: residentialAddressValidation.isValid,
    isEmpty: form.residentialAddress.trim().length === 0,
    isTooShort: form.residentialAddress.trim().length > 0 && !residentialAddressValidation.isValid,
  };

  return {
    fullName,
    residentialAddress,
    phoneNumber,
    isFormValid: Object.entries({ fullName, residentialAddress, phoneNumber }).every(
      ([field, validation]) => !fields.some((selected) => selected === field) || validation.isValid,
    ),
  };
};

export function useSignupUserProfile(fields: readonly ProfileField[] = USER_PROFILE_FIELDS) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UserProfileFormData>({
    fullName: '',
    dateOfBirth: '',
    residentialAddress: '',
    phoneCountryCode: DEFAULT_COUNTRY.phoneCode,
    phoneNumber: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingProfileUuid, setExistingProfileUuid] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(DEFAULT_COUNTRY);

  const formValidation = useMemo(() => {
    return validateUserProfile(form, fields);
  }, [form, fields]);

  const loadUserProfile = useCallback(async () => {
    try {
      const response = await getUserProfiles(apiClient);
      const profileData = response.data;

      if (profileData && profileData.results && profileData.count > 0) {
        const existingProfile = profileData.results[0]!;
        setExistingProfileUuid(existingProfile.uuid);

        if (existingProfile.phoneCountryCode) {
          const detectedCountry = COUNTRIES.find((c) => c.phoneCode === existingProfile.phoneCountryCode);
          if (detectedCountry) {
            setSelectedCountry(detectedCountry);
          }
        }

        let formattedPhoneNumber = existingProfile.phoneNumber || '';
        if (existingProfile.phoneNumber && existingProfile.phoneCountryCode) {
          const country = COUNTRIES.find((c) => c.phoneCode === existingProfile.phoneCountryCode) || DEFAULT_COUNTRY;
          formattedPhoneNumber = formatPhoneForDisplay(existingProfile.phoneNumber, country);
        }

        setForm({
          fullName: existingProfile.fullName || '',
          dateOfBirth: existingProfile.dateOfBirth || '',
          residentialAddress: existingProfile.residentialAddress || '',
          phoneCountryCode: existingProfile.phoneCountryCode || DEFAULT_COUNTRY.phoneCode,
          phoneNumber: formattedPhoneNumber,
        });
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
    let processedValue = value;

    if (field === 'phoneNumber') {
      const cleanValue = cleanPhoneNumber(value);
      processedValue = formatPhoneForDisplay(cleanValue, selectedCountry);
    }

    setForm((prev) => ({
      ...prev,
      [field]: processedValue,
    }));

    if (errors[field]) {
      const newErrors = { ...errors };
      delete newErrors[field];
      setErrors(newErrors);
    }
    setGeneralError('');
  };

  const handleCountryChange = (country: CountryData) => {
    setSelectedCountry(country);

    setForm((prev) => {
      const cleanNumber = prev.phoneNumber ? cleanPhoneNumber(prev.phoneNumber) : '';
      const formattedNumber = cleanNumber ? formatPhoneForDisplay(cleanNumber, country) : '';

      return {
        ...prev,
        phoneCountryCode: country.phoneCode,
        phoneNumber: formattedNumber,
      };
    });

    if (errors.phoneNumber || errors.phoneCountryCode) {
      const newErrors = { ...errors };
      delete newErrors.phoneNumber;
      delete newErrors.phoneCountryCode;
      setErrors(newErrors);
    }
    setGeneralError('');
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (fields.includes('fullName') && !form.fullName.trim()) {
      newErrors.fullName = ['Full name is required'];
    }

    const dateOfBirth = form.dateOfBirth.trim();
    if (fields.includes('dateOfBirth') && !dateOfBirth) {
      newErrors.dateOfBirth = ['Date of birth is required'];
    } else if (fields.includes('dateOfBirth') && (!isCalendarDate(dateOfBirth) || dateOfBirth > utcToday())) {
      newErrors.dateOfBirth = [DATE_OF_BIRTH_IN_FUTURE];
    }

    if (fields.includes('residentialAddress') && !form.residentialAddress.trim()) {
      newErrors.residentialAddress = ['Residential address is required'];
    }

    if (fields.includes('phoneNumber') && !form.phoneNumber.trim()) {
      newErrors.phoneNumber = ['Phone number is required'];
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
      const values = {
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth.trim(),
        phoneNumber: cleanPhoneNumber(form.phoneNumber),
        residentialAddress: form.residentialAddress.trim(),
      };
      const formattedData = Object.fromEntries(fields.map((field) => [field, values[field]]));
      if (fields.includes('phoneNumber')) formattedData.phoneCountryCode = selectedCountry.phoneCode;

      await updateUserProfile(apiClient, existingProfileUuid, formattedData);
      await queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY });

      onSuccess();
    } catch (error: unknown) {
      console.error(`User profile update failed: ${describeFailure(error)}`);
      const reading = readApiError(error, {
        fallback: 'Failed to save profile. Please try again.',
        displayedFields: fields,
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
    selectedCountry,
    countries: COUNTRIES,
    setFieldValue,
    handleCountryChange,
    handleSubmit,
    retryLoad,
  };
}
