// @vitest-environment jsdom

import {
  addCalendarDays,
  utcToday,
  COMPANY_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS,
  type Company,
  type CompanyDocument,
  type OwnCompanyAppointment,
  type CompanyEligibilityRequest,
  USER_PREFERENCES_QUERY_KEY,
  AUTH_QUERY_KEY,
  eligibilityRecordsKey,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Link, useLocation } from 'react-router-dom';
import { CompanyProfile } from '@pages/settings/CompanyProfile';
import CompanyPage from '.';
import CompanyTeamPage from './team';
import CompanyEligibilityPage from './eligibility';
import { APPOINTMENT, companyPreferences, companyRecord, renderCompanyPage } from '../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const EMPTY = { results: [], next: null, previous: null, count: 0 };
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
let client: QueryClient;
let company: Company;
let failed: string | null;
function CompanyView() {
  return useLocation().hash === '#documents' ? <CompanyPage /> : <CompanyProfile />;
}
function show() {
  return renderCompanyPage(
    client,
    <>
      <CompanyView />
      <Link to="/company#documents">Open company documents</Link>
    </>,
    'Profile',
    { entry: '/company', path: '/company' },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
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

it('shows focused company details without share classes, and uploads documents to the selected company and type', async () => {
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
  expect(screen.getByText('Shared')).toBeTruthy();

  const file = new File(['Synthetic company supporting copy'], 'company-constitution.pdf', { type: 'application/pdf' });
  const companyDocument: CompanyDocument = {
    uuid: 'document-one',
    company: company.uuid,
    documentType: 'constitution',
    documentTypeDisplay: 'Company Constitution',
    name: file.name,
    fileUrl: '/private/company-constitution.pdf',
    createdAt: '2026-10-14T00:00:00Z',
    isVerified: false,
    verifiedAt: null,
  };
  api.post.mockImplementation(async (url: string, body: FormData, config: { ledovaSubmissionGuard: () => void }) => {
    config.ledovaSubmissionGuard();
    expect(url).toBe(`${COMPANY}documents/`);
    expect(body.get('document_type')).toBe('constitution');
    expect(body.get('name')).toBe(file.name);
    expect((body.get('file') as File).name).toBe(file.name);
    expect((body.get('file') as File).size).toBe(file.size);
    company = { ...company, documents: [...company.documents, companyDocument] };
    return { data: companyDocument };
  });
  fireEvent.click(screen.getByRole('link', { name: 'Open company documents' }));
  const uploadOpener = await screen.findByRole('button', { name: 'Upload document' });
  fireEvent.click(uploadOpener);
  let uploadForm = await screen.findByRole('form', { name: 'Upload Other documents' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(uploadForm).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Upload document' })));
  fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
  uploadForm = await screen.findByRole('form', { name: 'Upload Other documents' });
  fireEvent.change(within(uploadForm).getByLabelText('Category'), { target: { value: 'constitution' } });
  uploadForm = await screen.findByRole('form', { name: 'Upload Company Constitution' });
  fireEvent.change(within(uploadForm).getByLabelText('File'), { target: { files: [file] } });
  company = {
    ...company,
    documents: [
      {
        ...companyDocument,
        uuid: 'document-other-admin',
        name: 'another-admin-constitution.pdf',
        fileUrl: '/private/another-admin-constitution.pdf',
      },
    ],
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: COMPANY_QUERY_KEY });
  });
  uploadForm = await screen.findByRole('form', { name: 'Upload Company Constitution' });
  expect((within(uploadForm).getByLabelText('Category') as HTMLSelectElement).value).toBe('constitution');
  expect(within(uploadForm).getByRole('option', { name: 'Company Constitution' })).toBeTruthy();
  expect((within(uploadForm).getByLabelText('File') as HTMLInputElement).files?.[0]).toBe(file);
  fireEvent.click(within(uploadForm).getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Upload Company Constitution' })).toBeNull());
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: `View ${file.name}` }).getAttribute('href')).toBe(companyDocument.fileUrl);
  fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
  uploadForm = await screen.findByRole('form', { name: 'Upload Other documents' });
  expect(within(uploadForm).queryByRole('option', { name: 'Company Constitution' })).toBeNull();
  expect(within(uploadForm).getByRole('option', { name: 'Other documents' })).toBeTruthy();
  expect((within(uploadForm).getByLabelText('Category') as HTMLSelectElement).value).toBe('other');
  fireEvent.click(within(uploadForm).getByRole('button', { name: 'Cancel' }));
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
  const acceptOpener = screen.getByRole('button', { name: 'Accept a company invitation' });
  fireEvent.click(acceptOpener);
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: 'synthetic-draft-code' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.activeElement).toBe(acceptOpener));
  fireEvent.click(acceptOpener);
  expect((screen.getByLabelText('Invitation code') as HTMLInputElement).value).toBe('synthetic-draft-code');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
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
  expect(api.post).toHaveBeenCalledTimes(1);

  cleanup();
  client.clear();
  failed = null;
  const queueUrl = `${COMPANY}eligibility-requests/`;
  const requestUuid = '00000000-0000-4000-8000-000000000072';
  const expiresAt = `${addCalendarDays(utcToday(), 1)}T12:00`;
  const eligibility: CompanyEligibilityRequest = {
    uuid: requestUuid,
    company: company.uuid,
    userAccount: 'participant-account',
    source: '00000000-0000-4000-8000-000000000073',
    category: 'professional_investor',
    outcome: 'pending',
    decision: null,
    withdrawal: null,
    digest: 'synthetic-request-digest',
    evidenceHash: 'synthetic-evidence-hash',
    sourceFingerprint: 'synthetic-source-fingerprint',
    idempotencyKey: '00000000-0000-4000-8000-000000000074',
    requestedExpiresAt: expiresAt,
    submittedAt: '2026-10-25T00:00:00Z',
    submittedBy: 1,
    version: '1',
    sharedSummary: {
      category: 'professional_investor',
      source: '00000000-0000-4000-8000-000000000073',
      userAccount: 'participant-account',
      company: company.uuid,
      declarationText: 'Synthetic private eligibility declaration',
      submittedAt: '2026-10-25T00:00:00Z',
      requestedExpiresAt: expiresAt,
    },
  };
  let authorityGate: Promise<void> | null = null;
  let otherAccount = false;
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === appointmentsUrl) {
      if (authorityGate) await authorityGate;
      return {
        data: { ...EMPTY, results: otherAccount ? [] : [{ ...appointment, capabilities: ['prepare', 'approve'] }] },
      };
    }
    if (url === queueUrl) return { data: { ...EMPTY, count: 1, results: [eligibility] } };
    if (url === `${queueUrl}${requestUuid}/`) return { data: eligibility };
    if (
      [
        '/api/v1/whitelist/company-wallet-nominations/',
        '/api/v1/whitelist/company-wallet-targets/',
        '/api/v1/whitelist/company-wallet-instructions/',
      ].includes(url)
    )
      return { data: EMPTY };
    throw new Error(`Unexpected eligibility request: ${url}`);
  });
  api.post.mockImplementation(async (url: string) => {
    expect(url).toBe(`${queueUrl}${requestUuid}/decision-preview/`);
    return { data: { canDecide: true, previewDigest: 'synthetic-decision-digest', unmetRequirements: [] } };
  });
  renderCompanyPage(client, <CompanyEligibilityPage />, 'Company eligibility', {
    entry: `/company/eligibility?company=${company.uuid}`,
    path: '/company/eligibility',
  });
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  await screen.findByRole('button', { name: `View request ${requestUuid.slice(0, 8)}` });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
  const queueReads = () => api.get.mock.calls.filter(([url]) => url === queueUrl).length;
  const beforeSource = ownReads();
  const beforeQueue = queueReads();
  let releaseAuthority!: () => void;
  authorityGate = new Promise<void>((resolve) => {
    releaseAuthority = resolve;
  });
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(ownReads()).toBe(beforeSource);
  expect(queueReads()).toBe(beforeQueue);
  let authorityRead: Promise<unknown> = Promise.resolve();
  await act(async () => {
    authorityRead = client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(ownReads()).toBeGreaterThan(beforeSource));
  expect(queueReads()).toBe(beforeQueue);
  await act(async () => {
    authorityGate = null;
    releaseAuthority();
    await authorityRead;
    await client.invalidateQueries({ queryKey: eligibilityRecordsKey('company', ['profile-one', 'account-one', 0]) });
  });
  await waitFor(() => expect(queueReads()).toBeGreaterThan(beforeQueue));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  fireEvent.change(screen.getByLabelText('Your exact decision appointment'), { target: { value: appointment.uuid } });
  fireEvent.click(screen.getByRole('button', { name: `View request ${requestUuid.slice(0, 8)}` }));
  fireEvent.change(await screen.findByLabelText('Acceptance expiry (local date and time)'), {
    target: { value: expiresAt },
  });
  const previewOpener = screen.getByRole('button', { name: 'Preview company decision' });
  previewOpener.focus();
  fireEvent.click(previewOpener);
  const reviewHeading = await screen.findByRole('heading', { name: 'Review exact action' });
  await waitFor(() => expect(document.activeElement).toBe(reviewHeading));
  expect(screen.queryByRole('heading', { name: 'Company request queue' })).toBeNull();
  const duringReview = ownReads();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  expect(ownReads()).toBe(duringReview);
  expect(screen.getByRole('heading', { name: 'Review exact action' })).toBe(reviewHeading);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.activeElement).toBe(previewOpener));
  expect((screen.getByLabelText('Acceptance expiry (local date and time)') as HTMLInputElement).value).toBe(expiresAt);
  const beforeAccountChange = ownReads();
  otherAccount = true;
  await act(async () => {
    const preferences = companyPreferences();
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { ...preferences, userAccount: { ...preferences.userAccount!, uuid: 'account-two' } },
    });
  });
  await waitFor(() => expect(ownReads()).toBeGreaterThan(beforeAccountChange));
  expect(screen.queryByText('Synthetic private eligibility declaration')).toBeNull();
  expect(screen.queryByLabelText('Acceptance expiry (local date and time)')).toBeNull();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const beforeNewSession = ownReads();
  await act(async () => {
    client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
  });
  await act(async () => {
    client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  });
  await waitFor(() => expect(ownReads()).toBeGreaterThan(beforeNewSession));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  otherAccount = false;
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences() });
  });
  await screen.findByRole('button', { name: `View request ${requestUuid.slice(0, 8)}` });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const beforeAuthorityFailure = queueReads();
  failed = appointmentsUrl;
  const beforeIdleAuthorityRead = ownReads();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(ownReads()).toBe(beforeIdleAuthorityRead);
  expect(queueReads()).toBe(beforeAuthorityFailure);
  expect(screen.getByRole('button', { name: `View request ${requestUuid.slice(0, 8)}` })).toBeTruthy();
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true }));
  await screen.findByText("The company's eligibility records could not be loaded.");
  expect(queueReads()).toBe(beforeAuthorityFailure);
  expect(screen.queryByRole('button', { name: `View request ${requestUuid.slice(0, 8)}` })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview company decision' })).toBeNull();

  cleanup();
  client.clear();
  failed = null;
  const beforeUnavailableCompany = queueReads();
  renderCompanyPage(client, <CompanyEligibilityPage />, 'Company eligibility', {
    entry: '/company/eligibility?company=unavailable-company',
    path: '/company/eligibility',
  });
  await screen.findByText(/Current personal prepare or approve authority is required to read this company/);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(queueReads()).toBe(beforeUnavailableCompany);
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByText('Synthetic private eligibility declaration')).toBeNull();

  cleanup();
  client.clear();
  renderCompanyPage(client, <CompanyEligibilityPage />, 'Company eligibility', {
    entry: '/company/eligibility',
    path: '/company/eligibility',
  });
  await screen.findByRole('link', { name: 'Choose company on Dashboard' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(queueReads()).toBe(beforeUnavailableCompany);
});
