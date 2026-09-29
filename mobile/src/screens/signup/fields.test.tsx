import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import {
  COMPANY_REGISTRATION_FIELDS,
  EMAIL_VERIFICATION_FIELDS,
  FINANCIAL_PROFILE_FIELDS,
  SIGNUP_USER_FIELDS,
  USER_PROFILE_FIELDS,
} from '@ledova/shared';
import { CompanyRegistrationScreen } from './company-registration/CompanyRegistrationScreen';
import { EmailConfirmationScreen } from './email-confirmation/EmailConfirmationScreen';
import { FinancialProfileScreen } from './financial-profile/FinancialProfileScreen';
import { UserProfileScreen } from './user-profile/UserProfileScreen';
import { SignUpScreen } from './user/SignUpScreen';

const mockState = { errors: {} as Record<string, string[]> };

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../hooks/useRole', () => ({ useRole: () => ({ isCompany: false }) }));
jest.mock('../../services/tokenStorage', () => ({ storeTokens: jest.fn() }));
jest.mock('@ledova/shared', () => {
  const actual = jest.requireActual('@ledova/shared');
  const idle = {
    generalError: '',
    isLoading: false,
    isSubmitting: false,
    setFieldValue: jest.fn(),
    handleSubmit: jest.fn(),
    retryLoad: jest.fn(),
  };
  return {
    ...actual,
    useSignupUser: () => ({
      ...idle,
      form: { email: 'synthetic@example.test', password: 'long enough', passwordConfirm: 'long enough' },
      errors: mockState.errors,
      showPassword: false,
      passwordValidation: { isValid: true, lengthValid: true, notNumeric: true },
      togglePassword: jest.fn(),
    }),
    useEmailVerification: () => ({
      ...idle,
      email: 'synthetic@example.test',
      verificationCode: '123456',
      errors: mockState.errors,
      successMessage: '',
      isResending: false,
      setVerificationCode: jest.fn(),
      handleVerify: jest.fn(),
      handleResend: jest.fn(),
    }),
    useSignupUserProfile: () => ({
      ...idle,
      form: {
        fullName: 'Synthetic Person',
        dateOfBirth: '1990-01-01',
        residentialAddress: '1 Synthetic Street, Sydney',
        phoneCountryCode: '+61',
        phoneNumber: '491 570 156',
      },
      errors: mockState.errors,
      selectedCountry: actual.COUNTRIES[0],
      countries: actual.COUNTRIES,
      handleCountryChange: jest.fn(),
    }),
    useSignupFinancialProfile: () => ({
      ...idle,
      form: {
        userProfileId: 'profile-1',
        occupation: 'Engineer',
        sourceOfFunds: ['savings', 'other'],
        sourceOfFundsOtherText: 'Consulting',
        intendedUse: 'other',
        intendedUseOtherText: 'Research',
      },
      errors: mockState.errors,
      existingProfileUuid: 'financial-1',
      userProfileId: 'profile-1',
      toggleSourceOfFunds: jest.fn(),
    }),
    useSignupCompanyRegistration: () => ({
      ...idle,
      form: { name: 'Saved Company A', tradingName: 'Trading A', companyType: 'pty', acn: '000000019', abn: '' },
      errors: mockState.errors,
      loadError: null,
      hasLoadedForm: true,
      canSubmit: true,
    }),
  };
});

const REFUSABLE = [
  'email',
  'password',
  'passwordConfirm',
  'token',
  'fullName',
  'dateOfBirth',
  'residentialAddress',
  'phoneCountryCode',
  'phoneNumber',
  'userProfileId',
  'occupation',
  'sourceOfFunds',
  'sourceOfFundsOtherText',
  'intendedUse',
  'intendedUseOtherText',
  'name',
  'tradingName',
  'companyType',
  'acn',
  'abn',
  'primaryContact',
  'nonFieldErrors',
];

beforeEach(() => {
  mockState.errors = Object.fromEntries(REFUSABLE.map((key) => [key, [`Refused ${key}.`]]));
});

afterEach(async () => {
  await cleanup();
});

it.each<[string, React.ComponentType, readonly string[]]>([
  ['create account', SignUpScreen, SIGNUP_USER_FIELDS],
  ['email code', EmailConfirmationScreen, EMAIL_VERIFICATION_FIELDS],
  ['personal details', UserProfileScreen, USER_PROFILE_FIELDS],
  ['financial profile', FinancialProfileScreen, FINANCIAL_PROFILE_FIELDS],
  ['company registration', CompanyRegistrationScreen, COMPANY_REGISTRATION_FIELDS],
])('the %s screen renders a refusal under exactly the fields its list names', async (_, Screen, fields) => {
  const view = await render(<Screen />);

  const rendered = REFUSABLE.filter((key) => view.queryByText(`Refused ${key}.`));
  expect(new Set(rendered)).toEqual(new Set(fields));
});
