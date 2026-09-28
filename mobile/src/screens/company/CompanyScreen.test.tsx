import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMPANY_TOKEN_ENDPOINTS } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { CompanyScreen } from '.';

const mockNavigate = jest.fn();
let mockRole = 'company';
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { role: mockRole }, isLoading: false, isError: false }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
const get = jest.mocked(apiClient.get);
const patch = jest.mocked(apiClient.patch);
const post = jest.mocked(apiClient.post);
const LIST = '/api/v1/companies/';
const DETAIL = '/api/v1/companies/company-a/';
const company = {
  uuid: 'company-a',
  name: 'Fictional Company',
  status: 'draft',
  statusDisplay: 'Draft',
  phone: '01000',
  acn: '000000019',
  documents: [],
};
let current = { ...company };
let client: QueryClient;
let failure: string | null;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mockRole = 'company';
  failure = null;
  current = { ...company };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  mockNavigate.mockReset();
  patch.mockReset();
  post.mockReset();
  get.mockReset();
  get.mockImplementation(async (url, config) => {
    if (url === failure) throw new Error('Refused read');
    if (url === LIST) return { data: { results: [{ uuid: current.uuid, name: 'Incomplete summary' }] } };
    if (url === DETAIL) return { data: { ...current } };
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    return {
      data: {
        results:
          page === 1
            ? [{ uuid: 'foreign', companyUuid: 'elsewhere', name: 'Foreign class' }]
            : [
                {
                  uuid: 'class',
                  companyUuid: company.uuid,
                  name: 'Ordinary shares',
                  totalSupply: '9007199254740993',
                  statusDisplay: 'Draft',
                  tokenTypeDisplay: 'Ordinary',
                  symbol: 'ORD',
                },
              ],
        count: 2,
        next: page === 1 ? 'https://api.example.test/?page=2' : null,
      },
    };
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('uses complete company detail and every class page with exact quantities and working destinations', async () => {
  const view = await render(<CompanyScreen />, { wrapper });
  expect(await view.findByText('Fictional Company')).toBeTruthy();
  expect(await view.findByText('9,007,199,254,740,993 authorised shares')).toBeTruthy();
  expect(view.getByText('Share classes (1)')).toBeTruthy();
  expect(view.queryByText('Foreign class')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares' }));
  expect(mockNavigate).toHaveBeenCalledWith('TokenDetail', { uuid: 'class' });
  await fireEvent.press(view.getByRole('button', { name: 'Application' }));
  expect(mockNavigate).toHaveBeenCalledWith('Listing');
  await fireEvent.press(view.getByRole('button', { name: 'Register' }));
  expect(mockNavigate).toHaveBeenCalledWith('CompanyMain');
  await fireEvent.press(view.getByText('Published to your members'));
  expect(mockNavigate).toHaveBeenCalledWith('CompanyPublications');
});

it('keeps an edit draft after failed refresh and save refusal; submits changed fields only', async () => {
  const view = await render(<CompanyScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Phone'), '02000');
  failure = DETAIL;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  expect(view.getByLabelText('Phone').props.value).toBe('02000');
  expect(patch).not.toHaveBeenCalled();
  failure = null;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled());
  patch.mockRejectedValueOnce({ response: { data: { detail: 'Refused save' } } }).mockResolvedValue({ data: {} });
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.getByText('Refused save')).toBeTruthy());
  expect(view.getByLabelText('Phone').props.value).toBe('02000');
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.queryByLabelText('Phone')).toBeNull());
  expect(patch).toHaveBeenLastCalledWith(DETAIL, { phone: '02000' });
});

it('keeps create drafts locked while pending and retains them on refusal without issuing shares', async () => {
  let refuse!: (error: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  const view = await render(<CompanyScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Create share class' }));
  await fireEvent.changeText(view.getByLabelText('Class name'), 'Large class');
  await fireEvent.changeText(view.getByLabelText('Symbol'), 'big');
  await fireEvent.changeText(view.getByLabelText('Authorised shares'), '9007199254740993');
  await fireEvent.press(view.getAllByRole('button', { name: 'Create share class' }).at(-1)!);
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled());
  expect(view.getByLabelText('Authorised shares').props.editable).toBe(false);
  await act(() => refuse(new Error('Refused class')));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeEnabled());
  expect(view.getByLabelText('Authorised shares').props.value).toBe('9007199254740993');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.BASE, {
    company: 'company-a',
    name: 'Large class',
    symbol: 'BIG',
    tokenType: 'ordinary',
    totalSupply: '9007199254740993',
  });
});

it('refuses changed names when the application moves out of draft while preserving the input', async () => {
  const view = await render(<CompanyScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Company name'), 'New name');
  current.status = 'active';
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByLabelText('Company name').props.editable).toBe(false));
  expect(view.getByLabelText('Company name').props.value).toBe('New name');
  expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

it('makes no company or class reads for a member-only account', async () => {
  mockRole = 'member';
  const view = await render(<CompanyScreen />, { wrapper });
  expect(view.getByText('Verify your company access before opening Company.')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});
