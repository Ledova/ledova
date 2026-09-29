// @vitest-environment jsdom

import React from 'react';
import type { AxiosInstance } from 'axios';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignupCompanyRegistration } from './SignupCompanyRegistration';
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const api = { get: vi.fn(), patch: vi.fn(), post: vi.fn() };

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

let client: QueryClient;
let companyA: () => Promise<{ data: typeof detailA }>;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
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

it('uses the real registration retry screen and preserves visible edits on a failed refresh', async () => {
  companyA = () => Promise.reject(new Error('Detail unavailable'));
  const view = render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <SignupCompanyRegistration />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.getByText('Detail unavailable')).toBeTruthy());
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
  companyA = () => Promise.resolve({ data: detailA });
  fireEvent.click(view.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(view.getByDisplayValue(detailA.abn)).toBeTruthy());
  fireEvent.change(view.getByDisplayValue(detailA.abn), { target: { value: otherAbn } });
  companyA = () => Promise.reject(new Error('Refresh unavailable'));
  await act(() => client.refetchQueries({ queryKey: ['signup', 'company-detail', 'company-a'] }));
  await waitFor(() => expect(view.getByText('Refresh unavailable')).toBeTruthy());
  expect(view.getByDisplayValue(otherAbn)).toBeTruthy();
  companyA = () => Promise.resolve({ data: detailA });
  fireEvent.click(view.getByRole('button', { name: 'Try Again' }));
  await waitFor(() => expect(view.queryByText('Refresh unavailable')).toBeNull());
  expect(view.getByDisplayValue(otherAbn)).toBeTruthy();
});
