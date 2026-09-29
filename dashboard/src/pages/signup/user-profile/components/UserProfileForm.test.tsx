// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNTRIES, USER_PROFILE_FIELDS } from '@ledova/shared';

import { UserProfileForm } from './UserProfileForm';

const A_MESSAGE: Record<string, string> = {
  fullName: 'Enter your full legal name.',
  dateOfBirth: 'Enter a date in the past.',
  residentialAddress: 'Enter a street address.',
  phoneNumber: 'Enter a valid phone number.',
};

const valid = { isValid: true, isEmpty: false };

describe('every field USER_PROFILE_FIELDS names is one this form actually renders', () => {
  afterEach(cleanup);

  it.each(USER_PROFILE_FIELDS)('renders the error it is handed for %s', (field) => {
    render(
      <UserProfileForm
        form={{ fullName: '', dateOfBirth: '', residentialAddress: '', phoneCountryCode: '+61', phoneNumber: '' }}
        errors={{ [field]: [A_MESSAGE[field]] }}
        generalError=""
        isSubmitting={false}
        formValidation={{ fullName: valid, residentialAddress: valid, phoneNumber: valid, isFormValid: true }}
        selectedCountry={COUNTRIES[0]}
        countries={COUNTRIES}
        setFieldValue={vi.fn()}
        onCountryChange={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });
});
