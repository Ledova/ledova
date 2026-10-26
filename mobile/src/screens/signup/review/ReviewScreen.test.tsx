import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SignupCompletionGate } from '../../../navigation/SignupCompletionGate';
import { ReviewScreen } from '.';

const mockReset = jest.fn();
const mockComplete = jest.fn();
const mockResidentialAddress = '17 Example Street,\nSydney NSW 2000, Australia';
let mockProfileComplete = false;
let mockProfileError = false;
let mockRereading = false;
let mockCompany = false;
let mockPreferencesError = false;
let mockInterrupted = true;

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset, navigate: jest.fn() }) }));
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
      mockProfileError || mockRereading ? null : { uuid: 'profile-one', isSignupCompleted: mockProfileComplete },
    profile: { isLoading: false, isFetching: mockRereading, isError: mockProfileError, refetch: jest.fn() },
  }),
}));
jest.mock('@ledova/shared', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@ledova/shared'),
    useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: mockRereading, refetch: jest.fn() }),
    useUserPreferences: () => ({ isFetching: mockRereading, isError: mockPreferencesError, refetch: jest.fn() }),
    useSignupReview: (_role: string, onComplete: (guard: () => void) => Promise<void>) => {
      const [error, setError] = useState<string | null>(null);
      return {
        data: {
          userProfile: { fullName: 'Alex Member', residentialAddress: mockResidentialAddress },
          financialProfile: { sourceOfFunds: 'salary' },
        },
        isLoading: false,
        error: null,
        completionError: error,
        isSubmitting: false,
        canCompleteSignup: true,
        retryLoad: jest.fn(),
        completeSignup: async () => {
          mockComplete();
          if (mockInterrupted) {
            mockInterrupted = false;
            setError('The response was interrupted. Try again.');
            throw new Error('Interrupted');
          }
          setError(null);
          await onComplete(jest.fn());
        },
      };
    },
  };
});
afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

it('completes individual signup only through explicit Terms acceptance, resumes after an interrupted response, keeps unfinished profiles outside the account, waits for a readable role and sends unfinished company accounts to the shareholders-only notice', async () => {
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
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'ShareholdersOnly' }] }));
  expect(gate.queryByText('Completed account')).toBeNull();
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
