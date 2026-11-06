// @vitest-environment jsdom

import {
  addCalendarDays,
  utcToday,
  COMPANY_TOKEN_ENDPOINTS,
  type Company,
  type OwnCompanyAppointment,
  ownAppointmentsKey,
  IDENTITY_VERIFICATION_ENDPOINTS,
  IDENTITY_VERIFICATION_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanyProfile } from '@pages/settings/CompanyProfile';
import { IdentityVerificationModal } from '@components/IdentityVerificationModal';
import CompanyTeamPage from './team';
import ListingPage from './listing';
import { APPOINTMENT, companyPreferences, companyRecord, renderCompanyPage } from '../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const sdk = vi.hoisted(() => ({ init: vi.fn(), withConf: vi.fn(), on: vi.fn(), build: vi.fn(), launch: vi.fn() }));
vi.mock('@sumsub/websdk', () => ({ default: { init: sdk.init } }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const EMPTY = { results: [], next: null, previous: null, count: 0 };
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
let client: QueryClient;
let company: Company;
let failed: string | null;
function show() {
  return renderCompanyPage(client, <CompanyProfile />, 'Profile', { entry: '/settings', path: '*' });
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  sdk.init.mockReturnValue(sdk);
  sdk.withConf.mockReturnValue(sdk);
  sdk.on.mockReturnValue(sdk);
  sdk.build.mockReturnValue(sdk);
  sdk.launch.mockImplementation((selector: string) => {
    const marker = document.createElement('div');
    marker.textContent = 'Identity provider widget';
    document.querySelector(selector)?.appendChild(marker);
  });
  failed = null;
  company = companyRecord();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [company] } };
    if (url === COMPANY) return { data: { ...company } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockImplementation(async (_url, changes) => {
    company = { ...company, ...changes };
    return { data: { ...company } };
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('shows focused company details, keeps team drafts and retries unavailable identity status', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText(/Company information is provided by the company/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Company administration' })).toBeNull();
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Activation' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
  expect(screen.queryByText(/Share classes/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create share class' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit company' }));
  const sharing = screen.getByRole('checkbox', { name: 'Share ownership overview with members' });
  expect((sharing as HTMLInputElement).checked).toBe(false);
  fireEvent.click(sharing);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit company' })).toBeNull());
  expect(api.patch).toHaveBeenCalledWith(
    COMPANY,
    { shareOwnershipWithMembers: true },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(screen.getByText('Shared with members')).toBeTruthy();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(CLASSES);

  cleanup();
  client.clear();
  const appointmentsUrl = '/api/v1/company-authority/appointments/';
  const invitationsUrl = '/api/v1/company-authority/invitations/';
  const teamUrl = `${appointmentsUrl}team/`;
  const appointment: OwnCompanyAppointment = {
    ...APPOINTMENT,
    company: company.uuid,
    companyName: company.name,
    capabilities: ['admin', 'prepare'],
    delegatableCapabilities: ['prepare'],
  };
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === appointmentsUrl) return { data: { ...EMPTY, results: [appointment] } };
    if (url === invitationsUrl) return { data: EMPTY };
    if (url === teamUrl)
      return { data: [{ ...appointment, name: 'Private team administrator', email: 'administrator@example.test' }] };
    throw new Error(`Unexpected team request: ${url}`);
  });
  renderCompanyPage(client, <CompanyTeamPage />, 'Company team', {
    entry: `/company/team?company=${company.uuid}`,
    path: '/company/team',
  });
  await screen.findAllByText('Private team administrator');
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
  const invitationOpener = screen.getByRole('button', { name: 'Invite a company user' });
  fireEvent.click(invitationOpener);
  const invitationHeading = await screen.findByRole('heading', { name: 'Invite a company user' });
  expect(document.activeElement).toBe(invitationHeading);
  expect(screen.queryByRole('heading', { name: 'Your appointments' })).toBeNull();
  const deadline = addCalendarDays(utcToday(), 1);
  fireEvent.change(screen.getByLabelText('Invitation deadline (UTC)'), { target: { value: deadline } });
  const readsDuringEditing = api.get.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(api.get.mock.calls).toHaveLength(readsDuringEditing);
  const ownReads = () => api.get.mock.calls.filter(([url]) => url === appointmentsUrl).length;
  const beforeClosing = ownReads();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(ownReads()).toBeGreaterThan(beforeClosing));
  await waitFor(() => expect(document.activeElement).toBe(invitationOpener));
  fireEvent.click(invitationOpener);
  expect((screen.getByLabelText('Invitation deadline (UTC)') as HTMLInputElement).value).toBe(deadline);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('button', { name: 'Accept a company invitation' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Your appointments' })).toBeNull();
  failed = appointmentsUrl;
  const beforeIdleTeamRead = ownReads();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(ownReads()).toBe(beforeIdleTeamRead);
  expect(screen.getAllByText('Private team administrator').length).toBeGreaterThan(0);
  expect(screen.queryByText('Your appointments could not be loaded.')).toBeNull();
  const owner = { userUuid: 'profile-one', ownerAccountUuid: 'account-one' };
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true }));
  await screen.findAllByText('Your appointments could not be loaded.');
  expect(screen.queryAllByText('Private team administrator')).toHaveLength(0);
  expect((screen.getByRole('button', { name: 'Invite a company user' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.post).not.toHaveBeenCalled();

  cleanup();
  client.clear();
  failed = null;
  renderCompanyPage(client, <CompanyTeamPage />, 'Company team', {
    entry: `/company/team?company=${company.uuid}#accept`,
    path: '/company/team',
  });
  const acceptHeading = await screen.findByRole('heading', { name: 'Accept a company invitation' });
  await waitFor(() => expect(document.activeElement).toBe(acceptHeading));
  expect(screen.getByLabelText('Invitation code')).toBeTruthy();

  cleanup();
  client.clear();
  client.setQueryDefaults(IDENTITY_VERIFICATION_QUERY_KEY, { retryDelay: 0 });
  let statusUnavailable = true;
  let verified = false;
  api.get.mockImplementation(async (url: string) => {
    if (url === IDENTITY_VERIFICATION_ENDPOINTS.STATUS) {
      if (statusUnavailable) throw new Error('Identity provider is unavailable');
      return { data: { isVerified: verified, status: verified ? 'completed' : 'init' } };
    }
    throw new Error(`Unexpected identity request: ${url}`);
  });
  renderCompanyPage(client, <IdentityVerificationModal isOpen onClose={vi.fn()} />, 'Account', {
    entry: '/settings#account',
    path: '*',
  });
  await screen.findByText('Your identity verification status could not be loaded.');
  expect(screen.queryByRole('button', { name: 'Start verification' })).toBeNull();
  statusUnavailable = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Start verification' });
  expect(screen.queryByText(/financial regulations/)).toBeNull();

  const providerContainer = document.querySelector('#sumsub-profile-websdk-container');
  expect(providerContainer).toBeTruthy();
  statusUnavailable = true;
  api.post.mockResolvedValueOnce({ data: { accessToken: 'synthetic-provider-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start verification' }));
  await screen.findByText('Identity provider widget');
  await screen.findByText('Your identity verification status could not be loaded.');
  expect(screen.queryByRole('button', { name: 'Start verification' })).toBeNull();
  expect(document.querySelector('#sumsub-profile-websdk-container')).toBe(providerContainer);
  statusUnavailable = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByText('Your identity verification status could not be loaded.')).toBeNull());
  expect(document.querySelector('#sumsub-profile-websdk-container')).toBe(providerContainer);
  expect(screen.getByText('Identity provider widget')).toBeTruthy();
  expect(sdk.launch).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledExactlyOnceWith(IDENTITY_VERIFICATION_ENDPOINTS.TOKEN);

  verified = true;
  await act(async () => client.refetchQueries({ queryKey: IDENTITY_VERIFICATION_QUERY_KEY, exact: true }));
  await screen.findByRole('heading', { name: 'Already verified' });
  expect(screen.queryByRole('button', { name: 'Start verification' })).toBeNull();
  expect(screen.queryByText('Identity provider widget')).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(1);

  cleanup();
  client.clear();
  api.post.mockClear();
  company = companyRecord({
    activation: {
      appointment: '11111111-1111-4111-8111-111111111111',
      lifecycleRevision: 1,
      declarationVersion: '2026-10-04',
      declarationText: 'Synthetic company activation declaration.',
    },
  });
  let pausePreferences = false;
  let failPreferences = false;
  let showCompany = true;
  let releasePreferences: (() => void) | undefined;
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: showCompany ? [company] : [] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === '/api/user-preferences/') {
      if (pausePreferences)
        await new Promise<void>((resolve) => {
          releasePreferences = resolve;
        });
      if (failPreferences) throw new Error('Preferences unavailable');
      return { data: companyPreferences() };
    }
    throw new Error(`Unexpected activation request: ${url}`);
  });
  renderCompanyPage(client, <ListingPage />, 'Activation', { entry: '/company/listing', path: '/company/listing' });
  fireEvent.click(await screen.findByRole('button', { name: 'Review activation' }));
  const declaration = await screen.findByRole('checkbox', { name: 'I accept this declaration for this company.' });
  fireEvent.click(declaration);
  const confirmation = screen.getByRole('form', { name: 'Activate company' });
  pausePreferences = true;
  let recheck!: Promise<void>;
  act(() => {
    recheck = client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
    fireEvent.submit(confirmation);
  });
  await waitFor(() => expect(releasePreferences).toBeTypeOf('function'));
  await screen.findByText('Checking current company access…');
  expect(screen.queryByRole('form', { name: 'Activate company' })).toBeNull();
  expect((declaration as HTMLInputElement).checked).toBe(true);
  expect((declaration as HTMLInputElement).disabled).toBe(true);
  fireEvent.submit(confirmation);
  expect(api.post).not.toHaveBeenCalled();
  pausePreferences = false;
  await act(async () => {
    releasePreferences!();
    await recheck;
  });
  await waitFor(() => expect(screen.getByRole('form', { name: 'Activate company' })).toBe(confirmation));
  expect(screen.getByRole('checkbox', { name: 'I accept this declaration for this company.' })).toBe(declaration);
  expect((declaration as HTMLInputElement).checked).toBe(true);

  failPreferences = true;
  await act(async () => client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true }));
  expect((await screen.findByRole('alert')).textContent).toContain('Company information could not be loaded.');
  expect(screen.queryByRole('form', { name: 'Activate company' })).toBeNull();
  fireEvent.submit(confirmation);
  expect(api.post).not.toHaveBeenCalled();
  failPreferences = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByRole('form', { name: 'Activate company' })).toBe(confirmation));
  expect((declaration as HTMLInputElement).checked).toBe(true);

  company = {
    ...company,
    activation: { ...company.activation!, lifecycleRevision: 2, declarationText: 'Changed activation declaration.' },
  };
  await act(async () => client.refetchQueries({ queryKey: ['company'] }));
  expect(screen.queryByRole('form', { name: 'Activate company' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Review activation' }));
  await screen.findByText('Changed activation declaration.');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  const authorisedCompany = company;
  company = { ...company, administrativeAccess: { capabilities: [], draftSetup: false }, activation: null };
  await act(async () => client.refetchQueries({ queryKey: ['companies'] }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Activate company' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Review activation' })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();

  company = authorisedCompany;
  await act(async () => client.refetchQueries({ queryKey: ['companies'] }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review activation' }));
  await screen.findByRole('form', { name: 'Activate company' });
  showCompany = false;
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: {
        ...companyPreferences(),
        userProfile: 'another-profile',
        userAccount: { ...companyPreferences().userAccount!, uuid: 'another-account' },
      },
    });
  });
  expect(screen.queryByRole('form', { name: 'Activate company' })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});
