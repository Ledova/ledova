import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SignupCompletionGate } from '../../../navigation/SignupCompletionGate';
import { ReviewScreen } from '.';

const mockReset = jest.fn();
const mockComplete = jest.fn();
let mockProfileComplete = false;
let mockProfileError = false;
let mockSavedRequest: {
  originalFilename: string;
  requestedCapabilities: string[];
  delegatableCapabilities: string[];
  status: string;
} | null = null;

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset, navigate: jest.fn() }) }));
jest.mock('../../../navigation/DrawerNavigator', () => ({
  DrawerNavigator: () =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(jest.requireActual<typeof import('react-native')>('react-native').Text, null, 'Completed account'),
}));
jest.mock('../../../hooks/useRole', () => ({
  useRole: () => ({ role: 'company', isCompany: true, isLoading: false }),
}));
jest.mock('../../user-profile/useUserProfile', () => ({
  useUserProfile: () => ({
    userProfile: mockProfileError ? null : { uuid: 'profile-one', isSignupCompleted: mockProfileComplete },
    profile: { isLoading: false, isFetching: false, isError: mockProfileError, refetch: jest.fn() },
  }),
}));
jest.mock('@ledova/shared', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@ledova/shared'),
    useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: false, refetch: jest.fn() }),
    useUserPreferences: () => ({ refetch: jest.fn() }),
    useSignupReview: (_role: string, onComplete: (guard: () => void) => Promise<void>) => {
      const [request, setRequest] = useState(mockSavedRequest);
      const [ready, setReady] = useState(false);
      const [error, setError] = useState<string | null>(null);
      return {
        data: { userProfile: { fullName: 'Alex Company' }, financialProfile: null },
        company: { uuid: 'company-one', name: 'Paper Company', acn: '123456789' },
        isCompany: true,
        isLoading: false,
        error: null,
        completionError: error,
        isSubmitting: false,
        canCompleteSignup: true,
        authorityRequest: request,
        authorityReady: ready,
        authorityError: null,
        isResettingAuthority: false,
        resetAuthorityRequest: async () => {
          mockSavedRequest = null;
          setRequest(null);
        },
        retryLoad: jest.fn(),
        completeSignup: async () => {
          mockComplete();
          if (!request) {
            mockSavedRequest = {
              originalFilename: '',
              requestedCapabilities: ['admin'],
              delegatableCapabilities: ['admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'],
              status: 'pending',
            };
            setError('The response was interrupted. Retry the retained request.');
            throw new Error('Interrupted');
          }
          setReady(true);
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

it('accepts company authority and Terms through explicit completion without uploads or checkboxes, resumes setup and keeps unfinished profiles outside the account', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const first = await render(<ReviewScreen />, { wrapper });
  expect(first.getByRole('button', { name: 'Complete company setup' })).toBeEnabled();
  expect(first.queryByRole('checkbox')).toBeNull();
  expect(
    first.getByText(/By completing setup, you confirm that you are authorised to administer Paper Company/),
  ).toBeTruthy();
  expect(first.queryByRole('button', { name: 'Choose representative evidence' })).toBeNull();
  expect(mockComplete).not.toHaveBeenCalled();
  await fireEvent.press(first.getByRole('button', { name: 'Complete company setup' }));
  await first.findByText('The response was interrupted. Retry the retained request.');
  expect(mockReset).not.toHaveBeenCalled();
  await first.unmount();

  const resumed = await render(<ReviewScreen />, { wrapper });
  expect(resumed.getByRole('button', { name: 'Complete company setup' })).toBeEnabled();
  expect(resumed.queryByRole('checkbox')).toBeNull();
  expect(mockComplete).toHaveBeenCalledTimes(1);
  await fireEvent.press(resumed.getByRole('button', { name: 'Complete company setup' }));
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainApp' }] }));
  expect(mockComplete).toHaveBeenCalledTimes(2);
  await resumed.unmount();

  const gate = await render(<SignupCompletionGate />);
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'CompanyRegistration' }] }));
  expect(gate.queryByText('Completed account')).toBeNull();
  mockProfileComplete = true;
  await gate.rerender(<SignupCompletionGate />);
  expect(gate.getByText('Completed account')).toBeTruthy();
  mockProfileError = true;
  await gate.rerender(<SignupCompletionGate />);
  expect(gate.queryByText('Completed account')).toBeNull();
  expect(
    gate.getByText('Your signup progress could not be checked. Try again before opening your account.'),
  ).toBeTruthy();
  client.clear();
});
