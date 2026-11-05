import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AUTH_QUERY_KEY, USER_PROFILES_QUERY_KEY } from '@ledova/shared';
import { AccountTypeScreen } from '../account-type';
import { UserProfileScreen } from '../user-profile';
import { CompanyRegistrationScreen } from '../company-registration';
import { SignupCompletionGate } from '../../../navigation/SignupCompletionGate';
import { ReviewScreen } from '.';

const mockReset = jest.fn();
const mockNavigate = jest.fn();
const mockSaveProfile = jest.fn();
const mockSaveCompany = jest.fn();
const mockResetAuthority = jest.fn().mockResolvedValue(undefined);
const mockCompletionGuard = jest.fn();
const mockComplete = jest.fn();
const mockResidentialAddress = '17 Example Street,\nSydney NSW 2000, Australia';
let mockProfileComplete = false;
let mockProfileError = false;
let mockRereading = false;
let mockCompany = false;
let mockPreferencesError = false;
let mockInterrupted = true;
let mockFullName = 'Alex Member';
let mockIdentityRequired = false;
let mockAuthorityError: string | null = null;
let mockCompanyDetails = {
  name: 'Example Company Pty Ltd',
  tradingName: '',
  companyType: 'pty',
  acn: '929000000',
  abn: '',
};

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset, navigate: mockNavigate }) }));
jest.mock('../../../navigation/SignedInNavigator', () => ({
  SignedInNavigator: () =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(jest.requireActual<typeof import('react-native')>('react-native').Text, null, 'Completed account'),
}));
jest.mock('../../../hooks/useRole', () => ({
  useRole: () => ({ role: mockCompany ? 'company' : 'investor', isCompany: mockCompany, isLoading: false }),
}));
jest.mock('../../../hooks/useUserProfile', () => ({
  useUserProfile: () => ({
    userProfile:
      mockProfileError || mockRereading
        ? null
        : { uuid: 'profile-one', fullName: mockFullName, isSignupCompleted: mockProfileComplete },
    profile: { isLoading: false, isFetching: mockRereading, isError: mockProfileError, refetch: jest.fn() },
  }),
}));
jest.mock('@ledova/shared', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@ledova/shared'),
    useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: mockRereading, refetch: jest.fn() }),
    useUserPreferences: () => ({ isFetching: mockRereading, isError: mockPreferencesError, refetch: jest.fn() }),
    useSignupAccountType: () => ({
      account: { uuid: 'account-one' },
      isSubmitting: false,
      error: null,
      chooseRole: async (role: string, onChosen: () => void) => {
        mockCompany = role === 'company';
        onChosen();
      },
    }),
    useSignupUserProfile: () => {
      const [form, setForm] = useState({
        fullName: mockFullName,
        dateOfBirth: '1990-01-01',
        residentialAddress: mockResidentialAddress,
        phoneCountryCode: '+61',
        phoneNumber: '416004021',
      });
      return {
        form,
        errors: {},
        generalError: null,
        isLoading: false,
        isSubmitting: false,
        selectedCountry: { code: 'AU', name: 'Australia', flag: '🇦🇺', phoneCode: '+61' },
        countries: [],
        setFieldValue: (field: string, value: string) => setForm((current) => ({ ...current, [field]: value })),
        handleCountryChange: jest.fn(),
        handleSubmit: async (onSaved: () => void) => {
          mockSaveProfile(form);
          mockFullName = form.fullName;
          onSaved();
        },
        retryLoad: jest.fn(),
      };
    },
    useSignupCompanyRegistration: () => {
      const [form, setForm] = useState({ ...mockCompanyDetails });
      return {
        form,
        errors: {},
        generalError: null,
        loadError: null,
        hasLoadedForm: true,
        canSubmit: true,
        isLoading: false,
        isSubmitting: false,
        setFieldValue: (field: string, value: string) => setForm((current) => ({ ...current, [field]: value })),
        handleSubmit: async (onSaved: () => void) => {
          mockSaveCompany(form);
          mockCompanyDetails = form;
          onSaved();
        },
        retryLoad: jest.fn(),
      };
    },
    useSignupReview: (_role: string, onComplete: (guard: () => void) => Promise<void>) => {
      const [error, setError] = useState<string | null>(null);
      return {
        data: {
          userProfile: { fullName: mockFullName, residentialAddress: mockResidentialAddress },
          financialProfile: mockCompany ? null : { sourceOfFunds: 'salary' },
        },
        company: mockCompany ? { uuid: 'company-one', ...mockCompanyDetails } : null,
        isCompany: mockCompany,
        identityRequired: mockIdentityRequired,
        authorityError: mockAuthorityError,
        authorityRequest: mockAuthorityError ? { status: 'pending' } : null,
        isResettingAuthority: false,
        resetAuthorityRequest: mockResetAuthority,
        isLoading: false,
        error: null,
        completionError: error,
        isSubmitting: false,
        canCompleteSignup: !mockIdentityRequired && !mockAuthorityError,
        retryLoad: jest.fn(),
        completeSignup: async () => {
          mockComplete();
          if (mockInterrupted) {
            mockInterrupted = false;
            setError('The response was interrupted. Try again.');
            throw new Error('Interrupted');
          }
          setError(null);
          await onComplete(mockCompletionGuard);
        },
      };
    },
  };
});
beforeEach(() => {
  mockProfileComplete = false;
  mockProfileError = false;
  mockRereading = false;
  mockCompany = false;
  mockPreferencesError = false;
  mockInterrupted = true;
  mockFullName = 'Alex Member';
  mockIdentityRequired = false;
  mockAuthorityError = null;
  mockCompanyDetails = {
    name: 'Example Company Pty Ltd',
    tradingName: '',
    companyType: 'pty',
    acn: '929000000',
    abn: '',
  };
});

afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

it('completes individual signup only through explicit Terms acceptance, resumes after an interrupted response, keeps unfinished profiles outside the account, waits for a readable role and resumes unfinished company accounts at their saved step', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const first = await render(<ReviewScreen />, { wrapper });
  expect(first.getByRole('button', { name: 'Complete Signup' })).toBeEnabled();
  expect(first.getByText('Residential address:')).toBeTruthy();
  expect(first.getByText(mockResidentialAddress, { normalizer: (value) => value }).props.children).toBe(
    mockResidentialAddress,
  );
  expect(first.queryByRole('checkbox')).toBeNull();
  expect(first.getByText(/By completing signup, you accept the/)).toBeTruthy();
  expect(mockComplete).not.toHaveBeenCalled();
  await fireEvent.press(first.getByRole('button', { name: 'Complete Signup' }));
  await first.findByText('The response was interrupted. Try again.');
  expect(mockReset).not.toHaveBeenCalled();
  await first.unmount();

  const resumed = await render(<ReviewScreen />, { wrapper });
  expect(resumed.getByRole('button', { name: 'Complete Signup' })).toBeEnabled();
  expect(resumed.queryByRole('checkbox')).toBeNull();
  expect(mockComplete).toHaveBeenCalledTimes(1);
  await fireEvent.press(resumed.getByRole('button', { name: 'Complete Signup' }));
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainApp' }] }));
  expect(mockComplete).toHaveBeenCalledTimes(2);
  await resumed.unmount();

  mockRereading = true;
  const gate = await render(<SignupCompletionGate />);
  expect(gate.queryByText('Completed account')).toBeNull();
  mockRereading = false;
  mockPreferencesError = true;
  await gate.rerender(<SignupCompletionGate />);
  expect(
    gate.getByText('Your signup progress could not be checked. Try again before opening your account.'),
  ).toBeTruthy();
  expect(mockReset).not.toHaveBeenCalledWith({ index: 0, routes: [{ name: 'AccountType' }] });
  mockPreferencesError = false;
  await gate.rerender(<SignupCompletionGate />);
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'AccountType' }] }));
  mockCompany = true;
  await gate.rerender(<SignupCompletionGate />);
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'CompanyRegistration' }] }));
  expect(gate.queryByText('Completed account')).toBeNull();
  mockFullName = '';
  mockReset.mockClear();
  await gate.rerender(<SignupCompletionGate />);
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'AccountType' }] }));
  mockProfileComplete = true;
  await gate.rerender(<SignupCompletionGate />);
  expect(gate.getByText('Completed account')).toBeTruthy();
  mockRereading = true;
  await gate.rerender(<SignupCompletionGate />);
  expect(gate.getByText('Completed account')).toBeTruthy();
  mockProfileError = true;
  await gate.rerender(<SignupCompletionGate />);
  expect(gate.queryByText('Completed account')).toBeNull();
  mockRereading = false;
  await gate.rerender(<SignupCompletionGate />);
  expect(gate.queryByText('Completed account')).toBeNull();
  expect(
    gate.getByText('Your signup progress could not be checked. Try again before opening your account.'),
  ).toBeTruthy();
  client.clear();
});

it('takes a company representative through personal and company details, then requires explicit authority and Terms completion after identity and saved-setup checks', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const account = await render(<AccountTypeScreen />, { wrapper });
  await fireEvent.press(account.getByRole('button', { name: 'Company representative' }));
  expect(mockCompany).toBe(true);
  expect(mockNavigate).toHaveBeenLastCalledWith('UserProfile');
  await account.unmount();

  const personal = await render(<UserProfileScreen />, { wrapper });
  await fireEvent.changeText(personal.getByLabelText('Full Name'), 'Alex Director');
  await fireEvent.press(personal.getByRole('button', { name: 'Continue' }));
  expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Alex Director' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('CompanyRegistration');
  await personal.unmount();

  const company = await render(<CompanyRegistrationScreen />, { wrapper });
  await fireEvent.changeText(company.getByLabelText('Registered company name'), 'New Example Pty Ltd');
  expect(company.getByLabelText('ACN').props.value).toBe('929000000');
  await fireEvent.press(company.getByRole('button', { name: 'Continue' }));
  expect(mockSaveCompany).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Example Pty Ltd' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('Review');
  await company.unmount();

  mockIdentityRequired = true;
  const review = await render(<ReviewScreen />, { wrapper });
  expect(review.getByText('New Example Pty Ltd')).toBeTruthy();
  expect(review.getByText('Proprietary Limited (Pty Ltd)')).toBeTruthy();
  expect(review.queryByText('Financial Profile')).toBeNull();
  expect(review.queryByRole('checkbox')).toBeNull();
  expect(review.getByText(/By completing setup, you confirm that you are authorised to administer/)).toBeTruthy();
  expect(review.getByRole('button', { name: 'Complete company setup' })).toBeDisabled();
  await fireEvent.press(review.getByRole('button', { name: 'Complete company setup' }));
  expect(mockComplete).not.toHaveBeenCalled();
  mockIdentityRequired = false;
  mockAuthorityError = 'Your saved setup uses previous permissions or an expiry. Update the saved setup to continue.';
  await review.rerender(<ReviewScreen />);
  expect(review.getByRole('button', { name: 'Complete company setup' })).toBeDisabled();
  await fireEvent.press(review.getByRole('button', { name: 'Update saved setup' }));
  expect(mockResetAuthority).toHaveBeenCalledTimes(1);
  mockAuthorityError = null;
  mockInterrupted = false;
  await review.rerender(<ReviewScreen />);

  let finishAuth: () => void = () => undefined;
  const refreshAuth = jest.spyOn(client, 'refetchQueries').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishAuth = resolve;
      }),
  );
  const refreshProfile = jest.spyOn(client, 'invalidateQueries');
  await fireEvent.press(review.getByRole('button', { name: 'Complete company setup' }));
  expect(mockComplete).toHaveBeenCalledTimes(1);
  expect(refreshAuth).toHaveBeenCalledWith({ queryKey: AUTH_QUERY_KEY, exact: true }, { throwOnError: true });
  expect(refreshProfile).toHaveBeenCalledWith({ queryKey: USER_PROFILES_QUERY_KEY }, { throwOnError: true });
  expect(mockCompletionGuard).not.toHaveBeenCalled();
  expect(mockReset).not.toHaveBeenCalled();
  finishAuth();
  await waitFor(() => expect(mockCompletionGuard).toHaveBeenCalledTimes(1));
  expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainApp' }] });
  client.clear();
});
