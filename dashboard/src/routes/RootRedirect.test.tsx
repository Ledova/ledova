// @vitest-environment jsdom

import {
  ApiClientProvider,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS,
  COMPANY_ENDPOINTS,
  USER_ACCOUNT_ENDPOINTS,
  FEATURE_FLAG_ENDPOINTS,
  OWN_APPOINTMENTS_QUERY_KEY,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { APPOINTMENT, companyPreferences, prepareCompanyClient } from '../testSupport/company';
import { Sidebar } from '@components/Sidebar';
import { RootRedirect } from './RootRedirect';
import { COMPANY_DASHBOARD_PATH } from '@utils/paths';
import { SIGNUP_RESUMES_AT } from '@utils/paths';

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
  let withSidebar = false;
  let appointment: OwnCompanyAppointment = { ...APPOINTMENT, capabilities: ['prepare'], expiresAt: null };
  let appointmentsRefused = false;
  let appointmentsVisible = true;
  let holdAppointmentRead = false;
  let releaseAppointmentRead: (() => void) | undefined;
  let appointmentGuard = () => {};
  api.get.mockImplementation((url: string, config) => {
    if (url === '/api/user-preferences/') return Promise.resolve({ data: companyPreferences('investor') });
    if (url === USER_ACCOUNT_ENDPOINTS.BASE)
      return Promise.resolve({ data: companyPreferences('company').userAccount });
    if (url === FEATURE_FLAG_ENDPOINTS.BASE) return Promise.resolve({ data: { results: [], next: null, count: 0 } });
    if (url === '/api/v1/company-authority/appointments/') {
      appointmentGuard = config.ledovaSubmissionGuard;
      if (holdAppointmentRead) {
        holdAppointmentRead = false;
        return new Promise((resolve) => {
          releaseAppointmentRead = () => resolve({ data: { results: [appointment], next: null, count: 1 } });
        });
      }
      if (appointmentsRefused) return Promise.reject(new Error('Appointment read refused'));
      return Promise.resolve({
        data: { results: appointmentsVisible ? [appointment] : [], next: null, count: appointmentsVisible ? 1 : 0 },
      });
    }
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
    if (url === COMPANY_ENDPOINTS.BASE)
      return Promise.resolve({ data: { results: [], next: null, previous: null, count: 0 } });
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
  const showRoot = () =>
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
                    {withSidebar && <Sidebar />}
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
  try {
    showRoot();
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
    cleanup();
    client.clear();
    signupComplete = true;
    refused = false;
    companyAccess = false;
    withSidebar = true;
    prepareCompanyClient(client, 'investor');
    showRoot();
    expect(await screen.findByText('Personal overview')).toBeTruthy();
    expect(screen.queryByText('Company overview')).toBeNull();
    expect(await screen.findByRole('link', { name: 'Ledger' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Your shares' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByText('Company overview')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Check access' }));
    expect(await screen.findByText('Personal overview')).toBeTruthy();
    const currentAppointment = appointment;
    for (const patch of [
      { status: 'revoked' as const, isEffective: false, revokedAt: '2026-10-14T00:00:00Z' },
      { expiresAt: '2026-10-14T00:00:00Z' },
      { capabilities: ['read_register' as const] },
    ]) {
      appointment = { ...currentAppointment, ...patch };
      await act(async () => client.invalidateQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY }));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull());
      expect(screen.getByText('Personal overview')).toBeTruthy();
    }
    appointment = currentAppointment;
    await act(async () => client.invalidateQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY }));
    expect(await screen.findByRole('link', { name: 'Ledger' })).toBeTruthy();
    appointmentsRefused = true;
    await act(async () => client.invalidateQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull());
    appointmentsRefused = false;
    await act(async () => client.invalidateQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY }));
    expect(await screen.findByRole('link', { name: 'Ledger' })).toBeTruthy();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    holdAppointmentRead = true;
    const staleRead = client.refetchQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY });
    await waitFor(() => expect(releaseAppointmentRead).toBeTypeOf('function'));
    const staleGuard = appointmentGuard;
    appointmentsVisible = false;
    const foreign = companyPreferences('investor');
    act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: {
          ...foreign,
          userProfile: 'foreign-profile',
          userAccount: { ...foreign.userAccount!, uuid: 'foreign-account' },
        },
      }),
    );
    expect(() => staleGuard()).toThrow(/signed-in account changed/);
    await act(async () => {
      releaseAppointmentRead!();
      await staleRead;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull();
    expect(screen.getByText('Personal overview')).toBeTruthy();
  } finally {
    cleanup();
    client.clear();
    api.get.mockReset();
  }
});
