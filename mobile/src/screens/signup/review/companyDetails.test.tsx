import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { useReview } from './useReview';
import { ReviewScreen } from './index';

let mockRole = 'company';
const mockReset = jest.fn();
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn() } }));
jest.mock('../../../hooks/useRole', () => ({ useRole: () => ({ role: mockRole }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ reset: mockReset, navigate: jest.fn() }),
}));
const api = jest.mocked(apiClient);

const summaryA = { uuid: 'company-a', name: 'Saved A', companyType: 'pty', acn: '000000019' };
const detailA = { ...summaryA, abn: '51824753556' };
const list = { data: { count: 1, next: null, previous: null, results: [summaryA] } };
let client: QueryClient;
let companyA: () => Promise<{ data: typeof detailA }>;

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'company';
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  companyA = () => Promise.resolve({ data: detailA });
  api.get.mockImplementation((url: string) => {
    if (url === '/api/user-profiles/')
      return Promise.resolve({
        data: {
          results: [
            { uuid: 'profile-a', fullName: 'Synthetic Person', phoneNumber: '00000000', residentialAddress: null },
          ],
        },
      });
    if (url === '/api/financial-profiles/')
      return Promise.resolve({
        data: {
          results: [{ uuid: 'financial-a', occupation: 'Engineer', sourceOfFunds: [], intendedUse: 'savings' }],
        },
      });
    if (url === '/api/v1/companies/') return Promise.resolve(list);
    if (url === '/api/v1/companies/company-a/') return companyA();
    throw new Error(`Unexpected request: ${url}`);
  });
  api.patch.mockResolvedValue({ data: { uuid: 'profile-a' } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

it('finishing sign-up refreshes the profile and opens the app in place of the sign-up screens', async () => {
  mockRole = 'investor';
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const { result } = await renderHook(() => useReview(), { wrapper });
  await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

  await act(() => result.current.completeSignup());

  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainApp' }] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userProfiles'] });
});

it('renders a separately fetched ABN after retrying the real review error screen', async () => {
  companyA = () => Promise.reject({ response: { status: 503, data: { detail: 'Detail unavailable' } } });
  const view = await render(<ReviewScreen />, { wrapper });
  await waitFor(() => expect(view.getByText('Detail unavailable')).toBeTruthy());
  expect(view.queryByText(detailA.abn)).toBeNull();
  expect(view.queryByText('Company information is provided by the company.')).toBeNull();
  expect(api.patch).not.toHaveBeenCalled();
  companyA = () => Promise.resolve({ data: detailA });
  await fireEvent.press(view.getByText('Try Again'));
  await waitFor(() => expect(view.getByText(detailA.abn)).toBeTruthy());
  expect(view.getAllByText('Company information is provided by the company.')).toHaveLength(1);
  expect(view.queryByText('Detail unavailable')).toBeNull();
});
