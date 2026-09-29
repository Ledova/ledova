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

const REFUSABLE = [
  'fullName',
  'dateOfBirth',
  'residentialAddress',
  'phoneCountryCode',
  'phoneNumber',
  'nonFieldErrors',
];

const valid = { isValid: true, isEmpty: false };

function formWith(errors: Record<string, string[]>) {
  return (
    <UserProfileForm
      form={{ fullName: '', dateOfBirth: '', residentialAddress: '', phoneCountryCode: '+61', phoneNumber: '' }}
      errors={errors}
      generalError=""
      isSubmitting={false}
      formValidation={{ fullName: valid, residentialAddress: valid, phoneNumber: valid, isFormValid: true }}
      selectedCountry={COUNTRIES[0]}
      countries={COUNTRIES}
      setFieldValue={vi.fn()}
      onCountryChange={vi.fn()}
      onSubmit={vi.fn()}
      onBack={vi.fn()}
    />
  );
}

describe('USER_PROFILE_FIELDS names the fields this form renders a refusal under', () => {
  afterEach(cleanup);

  it.each(USER_PROFILE_FIELDS)('renders the error it is handed for %s', (field) => {
    render(formWith({ [field]: [A_MESSAGE[field]] }));

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });

  it('names every field the form renders one under, and nothing else', () => {
    render(formWith(Object.fromEntries(REFUSABLE.map((key) => [key, [`Refused ${key}.`]]))));

    const rendered = REFUSABLE.filter((key) => screen.queryByText(`Refused ${key}.`));
    expect(new Set(rendered)).toEqual(new Set(USER_PROFILE_FIELDS));
  });
});
