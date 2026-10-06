import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, COMPANY_REGISTRATION_FIELDS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { CompanyRegistrationScreen } from './CompanyRegistrationScreen';
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
const api = jest.mocked(apiClient);

const summaryA = {
  uuid: 'company-a',
  name: 'Saved Company A',
  tradingName: 'Trading A',
  displayName: 'Saved Company A',
  companyType: 'pty',
  companyTypeDisplay: 'Proprietary',
  acn: '000000019',
  status: 'draft',
  statusDisplay: 'Draft',
  industry: '',
  city: '',
  state: '',
  isActive: false,
  isApproved: false,
  createdAt: '2026-01-01T00:00:00Z',
};
const detailA = { ...summaryA, abn: '51824753556' };
const otherAbn = '53004085616';
const list = { data: { count: 1, next: null, previous: null, results: [summaryA] } };
const A_MESSAGE: Record<string, string> = {
  name: 'Enter the registered name.',
  tradingName: 'Trading name is too long.',
  companyType: 'Choose a company type.',
  acn: 'This is not a valid ACN: its last digit does not check out against the other eight.',
  abn: 'This is not a valid ABN.',
};

let client: QueryClient;
let companyA: () => Promise<{ data: typeof detailA }>;

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  companyA = () => Promise.resolve({ data: detailA });
  api.get.mockImplementation((url: string) => {
    if (url === '/api/user-profiles/')
      return Promise.resolve({
        data: {
          results: [
            { uuid: 'profile-a', fullName: 'Synthetic Person', phoneNumber: '00000000', phoneCountryCode: '+61' },
          ],
        },
      });
    if (url === '/api/v1/companies/') return Promise.resolve(list);
    if (url === '/api/v1/companies/company-a/') return companyA();
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function screen() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyRegistrationScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

it('uses the real registration retry screen and preserves visible edits on a failed refresh', async () => {
  companyA = () => Promise.reject({ response: { status: 503, data: { detail: 'Detail unavailable' } } });
  const view = await screen();
  await waitFor(() => expect(view.getByText('Detail unavailable')).toBeTruthy());
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
  companyA = () => Promise.resolve({ data: detailA });
  await fireEvent.press(view.getByText('Try Again'));
  await waitFor(() => expect(view.getByDisplayValue(detailA.abn)).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('ABN'), otherAbn);
  companyA = () => Promise.reject({ response: { status: 503, data: { detail: 'Refresh unavailable' } } });
  await act(() => client.refetchQueries({ queryKey: ['signup', 'company-detail', 'company-a'] }));
  await waitFor(() => expect(view.getByText('Refresh unavailable')).toBeTruthy());
  expect(view.getByDisplayValue(otherAbn)).toBeTruthy();
  companyA = () => Promise.resolve({ data: detailA });
  await fireEvent.press(view.getByText('Try Again'));
  await waitFor(() => expect(view.queryByText('Refresh unavailable')).toBeNull());
  expect(view.getByDisplayValue(otherAbn)).toBeTruthy();
});

describe('every field COMPANY_REGISTRATION_FIELDS names is one this screen actually renders', () => {
  it.each(COMPANY_REGISTRATION_FIELDS)('shows the refusal the server gave for %s under its field', async (field) => {
    api.patch.mockRejectedValue({ response: { data: { [field]: [A_MESSAGE[field]] } } });
    const view = await screen();
    await waitFor(() => expect(view.getByDisplayValue(detailA.abn)).toBeTruthy());
    await fireEvent.press(view.getByText('Continue'));
    await waitFor(() => expect(view.getByText(A_MESSAGE[field])).toBeTruthy());
  });

  it('shows every sentence a field was given, not only the first', async () => {
    api.patch.mockRejectedValue({
      response: { data: { acn: ['Company with this acn already exists.', 'Try another.'] } },
    });
    const view = await screen();
    await waitFor(() => expect(view.getByDisplayValue(detailA.abn)).toBeTruthy());
    await fireEvent.press(view.getByText('Continue'));
    await waitFor(() => expect(view.getByText('Company with this acn already exists. Try another.')).toBeTruthy());
  });
});
