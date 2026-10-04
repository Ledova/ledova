import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, COMPANY_TOKEN_ENDPOINTS, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { companyDetail, companyPreferences, companyQueryClient } from '../../testSupport/companyAdministration';
import { apiClient } from '../../services/apiClient';
import { CompanyScreen } from '.';

const mockNavigate = jest.fn();
let mockRole = 'company';
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
const get = jest.mocked(apiClient.get);
const patch = jest.mocked(apiClient.patch);
const post = jest.mocked(apiClient.post);
const LIST = '/api/v1/companies/';
const DETAIL = '/api/v1/companies/company-a/';
const company = companyDetail({
  uuid: 'company-a',
  name: 'Fictional Company',
  status: 'draft',
  statusDisplay: 'Draft',
  phone: '01000',
  acn: '000000019',
  documents: [],
});
let current = { ...company };
let client: QueryClient;
let failure: string | null;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mockRole = 'company';
  failure = null;
  current = { ...company };
  client = companyQueryClient();
  mockNavigate.mockReset();
  patch.mockReset();
  post.mockReset();
  get.mockReset();
  get.mockImplementation(async (url, config) => {
    if (url === failure) throw new Error('Refused read');
    if (url === '/api/auth/verify/') return { data: { valid: true } };
    if (url === '/api/user-preferences/')
      return { data: companyPreferences(mockRole as Parameters<typeof companyPreferences>[0]) };
    if (url === LIST) return { data: { results: [{ ...current, name: 'Incomplete summary' }], next: null } };
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
  const view = await renderCompany();
  expect(await view.findByRole('header', { name: 'Fictional Company' })).toBeTruthy();
  expect(view.getByText('Company information is provided by the company.')).toBeTruthy();
  expect(view.getAllByText('Fictional Company')).toHaveLength(1);
  expect(view.queryByText('Company details')).toBeNull();
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
  await fireEvent.press(view.getByText('Representative authority'));
  expect(mockNavigate).toHaveBeenCalledWith('CompanyAuthority');
  await fireEvent.press(view.getByRole('button', { name: 'Company team' }));
  expect(mockNavigate).toHaveBeenCalledWith('CompanyTeam');
});

it('retains owner business entry points without granting administration or suggesting private documents are absent', async () => {
  current = {
    ...current,
    status: 'active',
    email: null,
    documents: [],
    administrativeAccess: { capabilities: [], draftSetup: false },
  };
  const view = await renderCompany();
  expect(await view.findByRole('button', { name: 'Ordinary shares' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Application' })).toBeTruthy();
  expect(view.getByText('Published to your members')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Edit company' })).toBeNull();
  expect(view.queryByRole('button', { name: /^Upload / })).toBeNull();
  expect(view.queryByText('No company documents yet.')).toBeNull();
  expect(view.getByText('Current company administration is required to access company documents.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Create share class' }));
  await fireEvent.changeText(view.getByLabelText('Class name'), 'Retained owner shares');
  await fireEvent.changeText(view.getByLabelText('Symbol'), 'own');
  await fireEvent.changeText(view.getByLabelText('Authorised shares'), '1000');
  await fireEvent.press(view.getAllByRole('button', { name: 'Create share class' }).at(-1)!);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe(COMPANY_TOKEN_ENDPOINTS.BASE);
  expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({ company: company.uuid }));
  expect(patch).not.toHaveBeenCalled();
});

it('offers Edit company under the page title rather than inside the company card', async () => {
  const view = await renderCompany();
  const card = (await view.findByRole('header', { name: 'Fictional Company' })).parent!;
  const title = view.getByRole('header', { name: 'Company' });
  const edit = view.getByRole('button', { name: 'Edit company' });
  expect(title.parent!.children).toEqual([title, edit.parent]);
  expect(within(card).queryByRole('button', { name: 'Edit company' })).toBeNull();
});

it('keeps the Company title over the access state, with nothing to act on', async () => {
  mockRole = 'investor';
  current = { ...current, isOwner: false, administrativeAccess: { capabilities: [], draftSetup: false } };
  const view = await renderCompany();
  const title = view.getByRole('header', { name: 'Company' });
  expect(title.parent!.children).toEqual([title]);
  expect(await view.findByText('No company administration available.')).toBeTruthy();
});

it('takes Edit company out of the title when a refresh fails, even with the company still cached', async () => {
  const view = await renderCompany();
  expect(await view.findByRole('button', { name: 'Edit company' })).toBeTruthy();
  failure = DETAIL;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  expect(await view.findByText('Company information could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.getByRole('header', { name: 'Company' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Edit company' })).toBeNull();
});

it('keeps an edit draft after failed refresh and save refusal; submits changed fields only', async () => {
  const view = await renderCompany();
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
  patch
    .mockRejectedValueOnce({ response: { data: { detail: 'Refused save' } } })
    .mockImplementation(async (_url, input) => {
      current = { ...current, ...(input as Partial<typeof current>) };
      return { data: { ...current } };
    });
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.getByText('Refused save')).toBeTruthy());
  expect(view.getByLabelText('Phone').props.value).toBe('02000');
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.queryByLabelText('Phone')).toBeNull());
  expect(patch).toHaveBeenLastCalledWith(
    DETAIL,
    { phone: '02000' },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function), ledovaSessionEpoch: expect.any(Number) }),
  );
});

it('keeps create drafts locked while pending and retains them on refusal without issuing shares', async () => {
  let refuse!: (error: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  const view = await renderCompany();
  await fireEvent.press(await view.findByRole('button', { name: 'Create share class' }));
  await fireEvent.changeText(view.getByLabelText('Class name'), 'Large class');
  await fireEvent.changeText(view.getByLabelText('Symbol'), 'big');
  await fireEvent.changeText(view.getByLabelText('Authorised shares'), '9007199254740993');
  expect(view.getByRole('button', { name: 'Ordinary', selected: true })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Preference', selected: false })).toBeTruthy();
  await fireEvent.press(view.getAllByRole('button', { name: 'Create share class' }).at(-1)!);
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled());
  expect(view.getByLabelText('Authorised shares').props.editable).toBe(false);
  await act(() => refuse(new Error('Refused class')));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeEnabled());
  expect(view.getByLabelText('Authorised shares').props.value).toBe('9007199254740993');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(
    COMPANY_TOKEN_ENDPOINTS.BASE,
    {
      company: 'company-a',
      name: 'Large class',
      symbol: 'BIG',
      tokenType: 'ordinary',
      totalSupply: '9007199254740993',
    },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
});

it('refuses changed names when the application moves out of draft while preserving the input', async () => {
  const view = await renderCompany();
  await fireEvent.press(await view.findByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Company name'), 'New name');
  current.status = 'active';
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByLabelText('Company name').props.editable).toBe(false));
  expect(view.getByLabelText('Company name').props.value).toBe('New name');
  expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

it('does not treat member metadata as company administration or load its classes', async () => {
  mockRole = 'investor';
  current = { ...current, isOwner: false, administrativeAccess: { capabilities: [], draftSetup: false } };
  const view = await renderCompany();
  expect(await view.findByText('No company administration available.')).toBeTruthy();
  expect(get.mock.calls.filter(([url]) => url !== LIST)).toHaveLength(0);
});

async function renderCompany() {
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: companyPreferences(mockRole as Parameters<typeof companyPreferences>[0]),
  });
  return render(<CompanyScreen />, { wrapper });
}

it('allows an investor with current personal admin to edit basic information without owner business widgets', async () => {
  mockRole = 'investor';
  current.isOwner = false;
  const view = await renderCompany();
  expect(await view.findByRole('button', { name: 'Edit company' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Application' })).toBeNull();
  expect(view.queryByText('Share classes')).toBeNull();
  expect(view.queryByRole('button', { name: 'Create share class' })).toBeNull();
  expect(view.queryByText('Published to your members')).toBeNull();
  expect(get.mock.calls.map(([url]) => url)).toEqual([LIST, DETAIL]);
});

it('retains a draft when an exact changed-field receipt cannot be confirmed', async () => {
  mockRole = 'investor';
  current.isOwner = false;
  const view = await renderCompany();
  await fireEvent.press(await view.findByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Phone'), '02000');
  patch.mockResolvedValue({ data: { ...current, uuid: 'foreign-company', phone: '02000' } });
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(await view.findByText('Company changes could not be saved. Try again.')).toBeTruthy();
  expect(view.getByLabelText('Phone').props.value).toBe('02000');
});

it('blocks a held confirmation callback after its dialog closes', async () => {
  const view = await renderCompany();
  await fireEvent.press(await view.findByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Phone'), '02000');
  const button = view.getByRole('button', { name: 'Save changes' });
  let fiber: typeof button.unstable_fiber | null = button.unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  const confirm = fiber?.memoizedProps.onPress;
  expect(typeof confirm).toBe('function');
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await act(() => confirm());
  expect(patch).not.toHaveBeenCalled();
});

it('retains the edit draft and owner business after list-only administration loss while hiding private documents and email', async () => {
  current.documents = [
    {
      uuid: 'private-doc',
      company: company.uuid,
      name: 'private.pdf',
      documentType: 'cert_inc',
      documentTypeDisplay: 'Certificate',
      fileUrl: 'https://example.invalid/private-doc',
      fileSize: 12,
      mimeType: 'application/pdf',
      isVerified: false,
      verifiedAt: null,
      createdAt: '2026-10-04T00:00:00Z',
    },
  ];
  const view = await renderCompany();
  await view.findByText('private.pdf');
  await fireEvent.press(view.getByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Phone'), '02000');
  current = { ...current, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(() => client.invalidateQueries({ queryKey: ['companies'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  expect(view.getByLabelText('Phone').props.value).toBe('02000');
  expect(view.queryByText('synthetic@example.test')).toBeNull();
  expect(view.queryByText('private.pdf')).toBeNull();
  expect(view.queryByRole('button', { name: 'View private.pdf' })).toBeNull();
  expect(view.getByRole('button', { name: 'Application' })).toBeTruthy();
  expect(view.getByText('Current company administration is required to access company documents.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(patch).not.toHaveBeenCalled();
});

it('closes private document removal after list-only administration loss without removing owner business access', async () => {
  current.documents = [
    {
      uuid: 'private-doc',
      company: company.uuid,
      name: 'private.pdf',
      documentType: 'cert_inc',
      documentTypeDisplay: 'Certificate',
      fileUrl: 'https://example.invalid/private-doc',
      fileSize: 12,
      mimeType: 'application/pdf',
      isVerified: false,
      verifiedAt: null,
      createdAt: '2026-10-04T00:00:00Z',
    },
  ];
  const view = await renderCompany();
  await fireEvent.press(await view.findByRole('button', { name: 'Remove private.pdf' }));
  expect(view.getByRole('button', { name: 'Confirm removal' })).toBeTruthy();
  current = { ...current, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(() => client.invalidateQueries({ queryKey: ['companies'] }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm removal' })).toBeNull());
  expect(view.queryByText('private.pdf')).toBeNull();
  expect(view.getByRole('button', { name: 'Application' })).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});
