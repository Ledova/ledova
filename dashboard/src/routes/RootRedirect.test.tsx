// @vitest-environment jsdom

import {
  ApiClientProvider,
  COMPANY_ENDPOINTS,
  FEATURE_FLAG_ENDPOINTS,
  USER_ACCOUNT_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import {
  APPOINTMENT,
  MEMBER_RECORD,
  companyPreferences,
  companyRecord,
  prepareCompanyClient,
} from '../testSupport/company';
import { Sidebar } from '@components/Sidebar';
import { CompanyContextProvider } from '@components/CompanyContextProvider';
import { LedgerNavigationProvider } from '@components/LedgerNavigationProvider';
import { useLedgerNavigation } from '@components/LedgerNavigation';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { ownershipCompaniesKey } from '@hooks/useOwnershipCompanies';
import { RootRedirect } from './RootRedirect';
import { SIGNUP_RESUMES_AT } from '@utils/paths';
import { TestRouter } from '../testSupport/TestRouter';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

function ContextActions() {
  const context = useCompanyContext();
  const ledger = useLedgerNavigation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Selected company">{context?.company?.name ?? 'No company selected'}</output>
      <button onClick={() => context?.selectCompany('company-a')}>Choose company A</button>
      <button onClick={() => context?.selectCompany('company-b')}>Choose company B</button>
      <button onClick={() => ledger.setState({ company: 'company-a', blocked: true, held: true })}>Hold action</button>
      <button onClick={() => ledger.setState({ company: 'company-a', blocked: false })}>Release action</button>
      <button onClick={() => void navigate(-1)}>Browser Back</button>
      <button onClick={() => void navigate(1)}>Browser Forward</button>
      <Link to="/">Check access</Link>
    </>
  );
}

it('uses one dashboard and company-scoped tasks, protects drafts and holds, and clears a late directory after the account changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepareCompanyClient(client, 'investor');
  let signupComplete = true;
  let personalDetailsSaved = false;
  let visible = true;
  let delayCompanies = false;
  let releaseCompanies: (() => void) | undefined;
  let companiesGuard = () => {};
  const company = companyRecord({ uuid: 'company-a', name: 'Company A' });
  const associations = [
    {
      ...MEMBER_RECORD,
      uuid: 'association-a',
      company: { ...MEMBER_RECORD.company, uuid: 'company-a', name: 'Company A' },
    },
    {
      ...MEMBER_RECORD,
      uuid: 'association-b',
      company: { ...MEMBER_RECORD.company, uuid: 'company-b', name: 'Company B' },
    },
  ];
  const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
  api.get.mockImplementation((url: string, config) => {
    if (url === '/api/user-preferences/') return Promise.resolve({ data: companyPreferences('investor') });
    if (url === USER_ACCOUNT_ENDPOINTS.BASE)
      return Promise.resolve({ data: companyPreferences('investor').userAccount });
    if (url === FEATURE_FLAG_ENDPOINTS.BASE) return Promise.resolve(page([]));
    if (url === '/api/v1/company-authority/appointments/') return Promise.resolve(page(visible ? [APPOINTMENT] : []));
    if (url === '/api/user-profiles/')
      return Promise.resolve(
        page([
          {
            uuid: client.getQueryData<{ data: { userProfile: string } }>(USER_PREFERENCES_QUERY_KEY)!.data.userProfile,
            isSignupCompleted: signupComplete,
            fullName: personalDetailsSaved ? 'Example Director' : '',
          },
        ]),
      );
    if (url === '/api/v1/tokens/member-records/') return Promise.resolve(page(visible ? associations : []));
    if (url === COMPANY_ENDPOINTS.BASE) {
      companiesGuard = config.ledovaSubmissionGuard;
      if (delayCompanies) {
        delayCompanies = false;
        return new Promise((resolve) => {
          releaseCompanies = () => resolve(page([company]));
        });
      }
      return Promise.resolve(page(visible ? [company] : []));
    }
    throw new Error(`Unexpected read ${url}`);
  });
  const show = (entry = '/') =>
    render(
      <QueryClientProvider client={client}>
        <ApiClientProvider client={api as unknown as AxiosInstance}>
          <TestRouter initialEntries={[entry]}>
            <LedgerNavigationProvider>
              <CompanyContextProvider>
                <Routes>
                  <Route path="/" element={<RootRedirect />} />
                  <Route
                    path="/home"
                    element={
                      <>
                        <Sidebar />
                        <main>
                          <p>Unified overview</p>
                          <form>
                            <label>
                              Dashboard draft
                              <input />
                            </label>
                          </form>
                          <ContextActions />
                        </main>
                      </>
                    }
                  />
                  <Route
                    path="/company/ledger"
                    element={
                      <>
                        <Sidebar />
                        <main>
                          <h1>Ledger task</h1>
                          <form>
                            <label>
                              Draft reference
                              <input />
                            </label>
                          </form>
                          <ContextActions />
                        </main>
                      </>
                    }
                  />
                  <Route path={SIGNUP_RESUMES_AT} element={<p>Resume signup</p>} />
                  <Route path="/signup/company-registration" element={<p>Resume company setup</p>} />
                </Routes>
              </CompanyContextProvider>
            </LedgerNavigationProvider>
          </TestRouter>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
  try {
    show();
    expect(await screen.findByText('Unified overview')).toBeTruthy();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).toBeNull();
    expect(screen.getByLabelText('Selected company').textContent).toBe('No company selected');
    fireEvent.click(screen.getByRole('button', { name: 'Choose company A' }));
    const ledgerLink = await screen.findByRole('link', { name: 'Ledger' });
    expect(ledgerLink.getAttribute('href')).toBe('/company/ledger?company=company-a');
    expect(screen.getByRole('link', { name: 'Your certificates' }).getAttribute('href')).toBe(
      '/home?company=company-a#documents',
    );
    expect(screen.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(1);
    fireEvent.click(ledgerLink);
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft reference' }), {
      target: { value: 'Unfinished draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(await screen.findByRole('dialog', { name: 'Leave this page?' })).toBeTruthy();
    expect(screen.queryByText('Unified overview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('textbox', { name: 'Draft reference' }) as HTMLInputElement).value).toBe(
      'Unfinished draft',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave page' }));
    expect(await screen.findByText('Unified overview')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Dashboard draft' }), {
      target: { value: 'Unfinished dashboard draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browser Forward' }));
    expect(await screen.findByRole('dialog', { name: 'Leave this page?' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Ledger task' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('textbox', { name: 'Dashboard draft' }) as HTMLInputElement).value).toBe(
      'Unfinished dashboard draft',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Browser Forward' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave page' }));
    await screen.findByRole('heading', { name: 'Ledger task' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft reference' }), {
      target: { value: 'Unfinished draft' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('dialog', { name: 'Leave this page?' })).toBeTruthy();
    expect(screen.queryByText('Unified overview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('textbox', { name: 'Draft reference' }) as HTMLInputElement).value).toBe(
      'Unfinished draft',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave page' }));
    expect(await screen.findByText('Unified overview')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Ledger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hold action' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leave this page?' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Ledger task' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose company B' }));
    expect(screen.getByRole('heading', { name: 'Ledger task' })).toBeTruthy();
    expect(screen.queryByText('Unified overview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Release action' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose company B' }));
    expect(await screen.findByText('Unified overview')).toBeTruthy();
    expect(screen.getByLabelText('Selected company').textContent).toBe('Company B');
    expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose company A' }));
    await screen.findByRole('link', { name: 'Ledger' });
    delayCompanies = true;
    const oldOwner = client.getQueryData<{ data: ReturnType<typeof companyPreferences> }>(
      USER_PREFERENCES_QUERY_KEY,
    )!.data;
    const staleRead = client.refetchQueries({
      queryKey: ownershipCompaniesKey({ userUuid: oldOwner.userProfile, ownerAccountUuid: oldOwner.userAccount!.uuid }),
    });
    await waitFor(() => expect(releaseCompanies).toBeTypeOf('function'));
    const staleGuard = companiesGuard;
    visible = false;
    act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: {
          ...oldOwner,
          userProfile: 'profile-two',
          userAccount: { ...oldOwner.userAccount!, uuid: 'account-two' },
        },
      }),
    );
    expect(() => staleGuard()).toThrow(/signed-in account changed/);
    await act(async () => {
      releaseCompanies!();
      await staleRead;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull();
    expect(screen.getByLabelText('Selected company').textContent).toBe('No company selected');
    cleanup();
    client.clear();
    prepareCompanyClient(client, 'company');
    signupComplete = false;
    show();
    expect(await screen.findByText('Resume signup')).toBeTruthy();
    cleanup();
    client.clear();
    prepareCompanyClient(client, 'company');
    personalDetailsSaved = true;
    show();
    expect(await screen.findByText('Resume company setup')).toBeTruthy();
  } finally {
    cleanup();
    client.clear();
    api.get.mockReset();
  }
});
