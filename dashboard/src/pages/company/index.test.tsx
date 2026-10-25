// @vitest-environment jsdom

import {
  addCalendarDays,
  utcToday,
  COMPANY_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS,
  type Company,
  type CompanyDocument,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyPage from '.';
import CompanyTeamPage from './team';
import { APPOINTMENT, companyRecord, renderCompanyPage } from '../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const EMPTY = { results: [], next: null, previous: null, count: 0 };
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
let client: QueryClient;
let company: Company;
let failed: string | null;
function show() {
  return renderCompanyPage(client, <CompanyPage />, 'Company', { entry: '/company', path: '/company' });
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

it('shows company details and destinations without share classes, and uploads documents to the selected company and type', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText(/Company information is provided by the company/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Company team/ }).getAttribute('href')).toBe('/company/team');
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Activation' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Published to your members' }).getAttribute('href')).toBe(
    '/company/publications',
  );
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
  expect(screen.queryByText(/Share classes/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create share class' })).toBeNull();
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
  fireEvent.click(screen.getByRole('link', { name: 'Company documents' }));
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
  renderCompanyPage(client, <CompanyTeamPage />, 'Company team');
  await screen.findAllByText('Private team administrator');
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
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await screen.findAllByText('Your appointments could not be loaded.');
  expect(screen.queryAllByText('Private team administrator')).toHaveLength(0);
  expect((screen.getByRole('button', { name: 'Invite a company user' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(1);
});
