// @vitest-environment jsdom

import { ApiClientProvider, USER_PREFERENCES_QUERY_KEY, COMPANY_TOKEN_ENDPOINTS } from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { companyPreferences, prepareCompanyClient } from '@pages/company/testSupport';
import { RootRedirect } from './RootRedirect';
import { COMPANY_DASHBOARD_PATH } from './companyDashboard';
import { SIGNUP_RESUMES_AT } from './signupRoutes';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

it('waits for actual register access, offers retry on refusal, and lands each account by access rather than preference', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepareCompanyClient(client, 'investor');
  let reject!: (reason: Error) => void;
  let refused = true;
  let companyAccess = true;
  let signupComplete = true;
  let personalDetailsSaved = false;
  api.get.mockImplementation((url: string) => {
    if (url === '/api/user-preferences/') return Promise.resolve({ data: companyPreferences('investor') });
    if (url === '/api/user-profiles/')
      return Promise.resolve({
        data: {
          results: [
            {
              uuid: client.getQueryData<{ data: { userProfile: string } }>(USER_PREFERENCES_QUERY_KEY)!.data
                .userProfile,
              isSignupCompleted: signupComplete,
              fullName: personalDetailsSaved ? 'Example Director' : '',
            },
          ],
          next: null,
          count: 1,
        },
      });
    if (url !== COMPANY_TOKEN_ENDPOINTS.REGISTER) throw new Error(`Unexpected read ${url}`);
    if (refused)
      return new Promise((_resolve, refuse) => {
        reject = refuse;
      });
    return Promise.resolve({
      data: {
        results: companyAccess ? [{ uuid: 'class', companyUuid: 'company', companyName: 'Example' }] : [],
        next: null,
        count: companyAccess ? 1 : 0,
      },
    });
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <ApiClientProvider client={api as unknown as AxiosInstance}>
          <MemoryRouter>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route
                path={COMPANY_DASHBOARD_PATH}
                element={
                  <>
                    <p>Company overview</p>
                    <Link to="/">Check access</Link>
                  </>
                }
              />
              <Route
                path="/home"
                element={
                  <>
                    <p>Personal overview</p>
                    <Link to="/">Check access</Link>
                  </>
                }
              />
              <Route
                path={SIGNUP_RESUMES_AT}
                element={
                  <>
                    <p>Resume signup</p>
                    <Link to="/">Check signup progress</Link>
                  </>
                }
              />
              <Route path="/signup/company-registration" element={<p>Resume company setup</p>} />
            </Routes>
          </MemoryRouter>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('status')).textContent).toMatch(/Checking your dashboard/);
    expect(screen.queryByText('Company overview')).toBeNull();
    await act(async () => reject(new Error('Access unavailable')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Personal overview')).toBeNull();
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Company overview')).toBeTruthy();
    companyAccess = false;
    const other = companyPreferences('company');
    act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
      }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Check access' }));
    expect(await screen.findByText('Personal overview')).toBeTruthy();
    expect(screen.queryByText('Company overview')).toBeNull();
    const registerReads = api.get.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER).length;
    signupComplete = false;
    refused = true;
    act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { ...other, userProfile: 'profile-three', userAccount: { ...other.userAccount!, uuid: 'account-three' } },
      }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Check access' }));
    expect(await screen.findByText('Resume signup')).toBeTruthy();
    expect(api.get.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER)).toHaveLength(registerReads);
    personalDetailsSaved = true;
    act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { ...other, userProfile: 'profile-four', userAccount: { ...other.userAccount!, uuid: 'account-four' } },
      }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Check signup progress' }));
    expect(await screen.findByText('Resume company setup')).toBeTruthy();
    expect(api.get.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER)).toHaveLength(registerReads);
  } finally {
    cleanup();
    client.clear();
    api.get.mockReset();
  }
});
