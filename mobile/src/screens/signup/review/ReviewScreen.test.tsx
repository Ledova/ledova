import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SignupCompletionGate } from '../../../navigation/SignupCompletionGate';
import { ReviewScreen } from '.';

const mockReset = jest.fn();
const mockComplete = jest.fn();
const mockPick = jest.fn();
const mockUpload = jest.fn();
let mockProfileComplete = false;
let mockProfileError = false;
let mockLeases = 0;
let mockSavedRequest: {
  originalFilename: string;
  requestedCapabilities: string[];
  delegatableCapabilities: string[];
  status: string;
} | null = null;
const mockFile = { uri: 'file:///synthetic/representative.pdf', name: 'representative.pdf', type: 'application/pdf' };

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
      const [evidence, setEvidence] = useState<Blob | null>(null);
      const [accepted, setAccepted] = useState(false);
      const [delegation, setDelegation] = useState(false);
      const [request, setRequest] = useState(mockSavedRequest);
      const [ready, setReady] = useState(false);
      const [locked, setLocked] = useState(false);
      const [error, setError] = useState<string | null>(null);
      return {
        data: { userProfile: { fullName: 'Alex Company' }, financialProfile: null },
        company: { uuid: 'company-one', name: 'Paper Company', acn: '123456789' },
        isCompany: true,
        isLoading: false,
        error: null,
        completionError: error,
        isSubmitting: false,
        canCompleteSignup: ready || (accepted && !!(request || evidence)),
        authorityRequest: request,
        authorityReady: ready,
        authorityError: null,
        authorityEvidence: evidence,
        authorityEvidenceLocked: locked,
        setAuthorityEvidence: setEvidence,
        authorityAccepted: accepted,
        setAuthorityAccepted: setAccepted,
        allowTeamDelegation: delegation,
        setAllowTeamDelegation: setDelegation,
        isResettingAuthority: false,
        resetAuthorityRequest: async () => {
          mockSavedRequest = null;
          setRequest(null);
          setAccepted(false);
          setEvidence(null);
        },
        retryLoad: jest.fn(),
        completeSignup: async () => {
          mockComplete();
          if (!request) {
            expect(mockLeases).toBe(1);
            mockSavedRequest = {
              originalFilename: mockFile.name,
              requestedCapabilities: ['admin'],
              delegatableCapabilities: [],
              status: 'pending',
            };
            setLocked(true);
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
jest.mock('../../../hooks/useDocumentUpload', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    useDocumentUpload: () => {
      const [file, setFile] = useState<typeof mockFile | null>(null);
      return {
        file,
        isPicking: false,
        isSubmitting: false,
        clear: () => setFile(null),
        pick: async () => {
          mockPick();
          setFile(mockFile);
          return true;
        },
        submit: async (consume: (value: { assertCurrent: () => void }) => Promise<void>) => {
          mockUpload();
          mockLeases++;
          try {
            await consume({ assertCurrent: jest.fn() });
            setFile(null);
            return true;
          } finally {
            mockLeases--;
          }
        },
      };
    },
  };
});

afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

it('requires company evidence and declaration, resumes a retained request without uploading again and keeps unfinished or refused profiles outside the account', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const first = await render(<ReviewScreen />, { wrapper });
  expect(first.getByRole('button', { name: 'Finish company setup' })).toBeDisabled();
  expect(first.getByRole('checkbox', { name: 'Allow me to appoint company administrators' })).not.toBeChecked();
  await fireEvent.press(first.getByRole('button', { name: 'Choose representative evidence' }));
  await first.findByText(mockFile.name);
  expect(first.getByRole('button', { name: 'Finish company setup' })).toBeDisabled();
  await fireEvent.press(first.getByRole('checkbox', { name: 'Accept authorisation declaration for Paper Company' }));
  expect(first.getByRole('button', { name: 'Finish company setup' })).toBeEnabled();
  await fireEvent.press(first.getByRole('button', { name: 'Finish company setup' }));
  await first.findByText('The response was interrupted. Retry the retained request.');
  expect(first.getByRole('button', { name: 'Replace evidence' })).toBeDisabled();
  expect(first.getByRole('checkbox', { name: 'Allow me to appoint company administrators' })).toBeDisabled();
  expect(
    first.getByText('The upload outcome is not confirmed. Retry with the same evidence and permissions.'),
  ).toBeTruthy();
  expect(mockReset).not.toHaveBeenCalled();
  await first.unmount();

  const resumed = await render(<ReviewScreen />, { wrapper });
  expect(resumed.getByText('Retained evidence: representative.pdf')).toBeTruthy();
  expect(resumed.getByText('Permissions you can delegate: None')).toBeTruthy();
  expect(resumed.getByRole('button', { name: 'Finish company setup' })).toBeDisabled();
  await fireEvent.press(resumed.getByRole('checkbox', { name: 'Accept authorisation declaration for Paper Company' }));
  await fireEvent.press(resumed.getByRole('button', { name: 'Finish company setup' }));
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainApp' }] }));
  expect(mockPick).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledTimes(1);
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
