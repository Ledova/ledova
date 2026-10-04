// @vitest-environment jsdom

import React from 'react';
import type { AxiosInstance } from 'axios';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignupReview } from './SignupReview';

const api = { get: vi.fn(), patch: vi.fn() };
vi.mock('@hooks/useRole', () => ({ useRole: () => ({ role: 'company' }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const summaryA = { uuid: 'company-a', name: 'Saved A', companyType: 'pty', acn: '000000019' };
const detailA = { ...summaryA, abn: '51824753556' };
const list = { data: { count: 1, next: null, previous: null, results: [summaryA] } };
let client: QueryClient;
let companyA: () => Promise<{ data: typeof detailA }>;

beforeEach(() => {
  vi.clearAllMocks();
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
    if (url === '/api/financial-profiles/') return Promise.resolve({ data: { results: [] } });
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

function page() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <SignupReview />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

it('renders a separately fetched ABN after retrying the real review error screen', async () => {
  companyA = () => Promise.reject({ response: { status: 503, data: { detail: 'Detail unavailable' } } });
  const view = page();
  await waitFor(() => expect(view.getByText('Detail unavailable')).toBeTruthy());
  expect(view.queryByText(detailA.abn)).toBeNull();
  expect(view.queryByText(/provided by the company/i)).toBeNull();
  expect(api.patch).not.toHaveBeenCalled();
  companyA = () => Promise.resolve({ data: detailA });
  fireEvent.click(view.getByRole('button', { name: 'Try Again' }));
  await waitFor(() => expect(view.getByText(detailA.abn)).toBeTruthy());
  expect(view.getAllByText(/provided by the company/i)).toHaveLength(1);
  expect(view.queryByText('Detail unavailable')).toBeNull();
});

it('shows the company type by name and the phone with its country code', async () => {
  const profileRows = api.get.getMockImplementation();
  api.get.mockImplementation((url: string) =>
    url === '/api/user-profiles/'
      ? Promise.resolve({
          data: {
            results: [
              {
                uuid: 'profile-a',
                fullName: 'Olivia Owner',
                phoneCountryCode: '+61',
                phoneNumber: '491570156',
                residentialAddress: null,
              },
            ],
          },
        })
      : profileRows!(url),
  );
  const view = page();
  await waitFor(() => expect(view.getByText('Proprietary Limited (Pty Ltd)')).toBeTruthy());
  expect(view.queryByText('pty')).toBeNull();
  expect(view.getByText('+61 491 570 156')).toBeTruthy();
});
