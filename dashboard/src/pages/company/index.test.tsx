// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COMPANY_TOKEN_ENDPOINTS, USER_PREFERENCES_QUERY_KEY, type Company } from '@ledova/shared';
import CompanyPage from '.';
import { companyRecord, documentRecord, prepareCompanyClient, renderCompanyPage } from './testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.BASE;
const EMPTY = { results: [], next: null, previous: null, count: 0 };
let client: QueryClient;
let company: Company;
let failed: string | null;
const shareClass = {
  uuid: 'class-one',
  companyUuid: 'company-one',
  name: 'Ordinary shares',
  symbol: 'ORD',
  tokenType: 'ordinary',
  tokenTypeDisplay: 'Ordinary',
  status: 'draft',
  statusDisplay: 'Draft',
  totalSupply: '9007199254740993',
};
function show() {
  return renderCompanyPage(client, <CompanyPage />, 'Company');
}
async function createForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Create share class' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Class name'), { target: { value: 'Ordinary shares' } });
  fireEvent.change(within(dialog).getByLabelText('Symbol'), { target: { value: 'ord' } });
  return dialog;
}
beforeEach(() => {
  vi.resetAllMocks();
  failed = null;
  company = companyRecord();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [company] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === CLASSES) return { data: { ...EMPTY, count: 1, results: [shareClass] } };
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
});

it('shows company details, exact draft share classes and the class/application destinations', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText(/Company information is provided by the company/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Company team/ }).getAttribute('href')).toBe('/company/team');
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(await screen.findByText('9,007,199,254,740,993 authorised shares')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Ordinary shares' }).getAttribute('href')).toBe(
    '/company/register/class-one',
  );
  expect(screen.getByRole('link', { name: 'Activation' }).getAttribute('href')).toBe('/company/listing');
  expect(screen.getByRole('link', { name: 'Published to your members' }).getAttribute('href')).toBe(
    '/company/publications',
  );
  expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/company/register');
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
});

it('retains owner business entry points without granting administration or suggesting private documents are absent', async () => {
  company = companyRecord({
    status: 'active',
    email: null,
    documents: [],
    administrativeAccess: { capabilities: [], draftSetup: false },
  });
  show();
  await screen.findByText(company.name);
  expect(await screen.findByRole('link', { name: 'Ordinary shares' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Activation' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Representative authority' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Published to your members' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit company' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Upload / })).toBeNull();
  expect(screen.queryByRole('link', { name: /^View / })).toBeNull();
  expect(screen.getByText('Current company administration is required to access company documents.')).toBeTruthy();
  const dialog = await createForm();
  fireEvent.change(within(dialog).getByLabelText('Authorised shares'), { target: { value: '1000' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create share class' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post.mock.calls[0][0]).toBe(CLASSES);
  expect(api.post.mock.calls[0][1].company).toBe(company.uuid);
  expect(api.patch).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

it('reads every class page, excludes other companies and retries a failed later page without showing partial or stale rows', async () => {
  let broken = true;
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url !== CLASSES) return original(url);
    if (config?.params?.page === 2) {
      if (broken) throw new Error('Second page unavailable');
      return {
        data: {
          ...EMPTY,
          results: [
            { ...shareClass, uuid: 'class-two', name: 'Preference shares' },
            { ...shareClass, uuid: 'other-class', companyUuid: 'other-company', name: 'Other company shares' },
          ],
        },
      };
    }
    return { data: { ...EMPTY, results: [shareClass], next: 'https://example.invalid/classes?page=2' } };
  });
  show();
  expect(await screen.findByRole('button', { name: 'Retry share classes' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Ordinary shares' })).toBeNull();
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry share classes' }));
  expect(await screen.findByRole('link', { name: 'Preference shares' })).toBeTruthy();
  expect(screen.queryByText('Other company shares')).toBeNull();
  broken = true;
  await act(async () => client.invalidateQueries({ queryKey: ['tokens'] }));
  await screen.findByRole('button', { name: 'Retry share classes' });
  expect(screen.queryByRole('link', { name: 'Preference shares' })).toBeNull();
});

it('distinguishes no classes from a failed read', async () => {
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string) => (url === CLASSES ? Promise.resolve({ data: EMPTY }) : original(url)));
  show();
  expect(await screen.findByText('No share classes yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry share classes' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Create share class' })).toBeTruthy();
});

it('scopes every class page to the selected company so unrelated pages cannot hide its classes', async () => {
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number; company_uuid?: string } }) => {
    if (url !== CLASSES) return original(url);
    if (config?.params?.page === 2) {
      if (config.params.company_uuid !== 'company-one') throw new Error('Unrelated company page unavailable');
      return { data: { ...EMPTY, results: [{ ...shareClass, uuid: 'class-two', name: 'Preference shares' }] } };
    }
    return { data: { ...EMPTY, results: [shareClass], next: 'https://example.invalid/classes?page=2' } };
  });
  show();
  expect(await screen.findByRole('link', { name: 'Preference shares' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Ordinary shares' })).toBeTruthy();
  expect(api.get.mock.calls.filter(([url]) => url === CLASSES)).toEqual([
    [CLASSES, { params: { page: 1, company_uuid: 'company-one' } }],
    [CLASSES, { params: { page: 2, company_uuid: 'company-one' } }],
  ]);
});

it.each(['/api/v1/companies/', COMPANY])(
  'shows %s failure without empty-company claims and retries it',
  async (endpoint) => {
    failed = endpoint;
    show();
    const retry = await screen.findByRole('button', { name: 'Retry company information' });
    expect(screen.queryByText('No company information available.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit company' })).toBeNull();
    failed = null;
    fireEvent.click(retry);
    expect(await screen.findByText(company.name)).toBeTruthy();
  },
);

it('saves only changed profile fields and surfaces a refusal while retaining the draft', async () => {
  api.patch.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { phone: ['Provide a contact number.'] } } }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await within(dialog).findByText('Provide a contact number.')).toBeTruthy();
  expect((within(dialog).getByLabelText('Phone') as HTMLInputElement).value).toBe('12345');
  expect(api.patch).toHaveBeenCalledWith(
    COMPANY,
    { phone: '12345' },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps the registered name read-only after submission while contact fields can change', async () => {
  company.status = 'active';
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  const dialog = await screen.findByRole('dialog');
  expect((within(dialog).getByLabelText('Company name') as HTMLInputElement).disabled).toBe(true);
  expect((within(dialog).getByLabelText('Phone') as HTMLInputElement).disabled).toBe(false);
});

it.each(['1.5', '1e3', '0', '-1', '9007199254740993'])(
  'validates an exact class supply %s without truncation',
  async (supply) => {
    show();
    const dialog = await createForm();
    fireEvent.change(within(dialog).getByLabelText('Authorised shares'), { target: { value: supply } });
    const submit = within(dialog).getByRole('button', { name: 'Create share class' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(supply !== '9007199254740993');
    fireEvent.click(submit);
    if (supply === '9007199254740993')
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          CLASSES,
          {
            company: 'company-one',
            name: 'Ordinary shares',
            symbol: 'ORD',
            tokenType: 'ordinary',
            totalSupply: supply,
          },
          expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
        ),
      );
    else expect(api.post).not.toHaveBeenCalled();
  },
);

it.each([
  { symbol: ['Symbol must contain only letters.'] },
  { symbol: ['Invalid symbol.'], totalSupply: ['Invalid quantity.'] },
  undefined,
])('retains class input and readable backend refusal %j', async (body) => {
  api.post.mockRejectedValue(Object.assign(new Error('HTTP 400'), { response: { data: body } }));
  show();
  const dialog = await createForm();
  fireEvent.change(within(dialog).getByLabelText('Authorised shares'), { target: { value: '1000' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create share class' }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).not.toContain('HTTP 400');
  if (body)
    for (const errors of Object.values(body))
      for (const message of errors ?? []) expect(alert.textContent).toContain(message);
  else expect(alert.textContent).toContain('The share class could not be created. Try again.');
  expect((within(dialog).getByLabelText('Class name') as HTMLInputElement).value).toBe('Ordinary shares');
  expect((within(dialog).getByLabelText('Authorised shares') as HTMLInputElement).value).toBe('1000');
});

it.each(['edit', 'create'])(
  'preserves the %s draft and blocks a mutation during failed company refresh',
  async (form) => {
    show();
    let dialog: HTMLElement;
    if (form === 'create') {
      dialog = await createForm();
      fireEvent.change(within(dialog).getByLabelText('Authorised shares'), { target: { value: '1000' } });
    } else {
      fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
      dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
    }
    failed = COMPANY;
    await act(async () => client.invalidateQueries({ queryKey: ['company', company.uuid] }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    const confirm = within(dialog).getByRole('button', {
      name: form === 'create' ? 'Create share class' : 'Save changes',
    }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    failed = null;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry company information' }));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(
      (within(dialog).getByLabelText(form === 'create' ? 'Authorised shares' : 'Phone') as HTMLInputElement).value,
    ).toBe(form === 'create' ? '1000' : '12345');
  },
);

it('lets an investor appointed administrator edit company information without loading owner business widgets', async () => {
  company.isOwner = false;
  prepareCompanyClient(client, 'investor');
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  expect(screen.queryByRole('button', { name: 'Create share class' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Activation' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(CLASSES);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.patch).toHaveBeenCalledTimes(1);
});

it('keeps a multi-company administrator on an explicit choice and closes the old draft when selection changes', async () => {
  const other = companyRecord({ uuid: 'company-two', name: 'Second company', isOwner: false });
  company.isOwner = false;
  prepareCompanyClient(client, 'investor');
  api.get.mockImplementation(async (url, config) => {
    if (url === '/api/v1/companies/')
      return config.params.page === 1
        ? { data: { ...EMPTY, results: [company], next: 'https://example.invalid/?page=2' } }
        : { data: { ...EMPTY, results: [other] } };
    return { data: url.endsWith('company-two/') ? other : company };
  });
  show();
  await screen.findByRole('option', { name: other.name });
  expect(screen.queryByRole('button', { name: 'Edit company' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: company.uuid } });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Phone'), { target: { value: 'Old draft' } });
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: other.uuid } });
  await screen.findByRole('heading', { name: other.name });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.patch).not.toHaveBeenCalled();
});

it('does not refresh or cache a foreign company edit receipt', async () => {
  api.patch.mockResolvedValue({ data: { ...company, uuid: 'foreign-company', phone: '12345' } });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await within(dialog).findByText(/company changes could not be confirmed/)).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.getByText('Harbour Example Pty Ltd')).toBeTruthy();
});

it('stops a held edit transport after account change and discards a delayed original-account outcome', async () => {
  let release: (value: unknown) => void = () => {};
  api.patch.mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  const guard = api.patch.mock.calls[0][2].ledovaSubmissionGuard;
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'profile-two', userAccount: { uuid: 'account-two', role: 'investor' } },
    }),
  );
  expect(guard).toThrow();
  await act(async () => release({ data: { ...company, phone: '12345' } }));
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('uses current authority for open edit confirmation and retains its draft on authority refusal', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  company.administrativeAccess = { capabilities: [], draftSetup: false };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company', company.uuid] });
  });
  const confirm = within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(true));
  fireEvent.click(confirm);
  expect(api.patch).not.toHaveBeenCalled();
  expect((within(dialog).getByLabelText('Phone') as HTMLInputElement).value).toBe('12345');
});

it('exposes company documents to an investor administrator and retains offered-document refusal until a genuine retry', async () => {
  company.isOwner = false;
  company.documents = [documentRecord('cert_inc')];
  prepareCompanyClient(client, 'investor');
  api.delete.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Document is retained by an offering.' } } }),
  );
  api.delete.mockImplementationOnce(async () => {
    company.documents = [];
    return { status: 204 };
  });
  show();
  const link = await screen.findByRole('link', { name: 'View cert_inc.pdf' });
  expect(link.getAttribute('href')).toBe(documentRecord('cert_inc').fileUrl);
  fireEvent.click(screen.getByRole('button', { name: 'Remove cert_inc.pdf' }));
  let dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove document' }));
  expect(await within(dialog).findByText('Document is retained by an offering.')).toBeTruthy();
  expect(screen.getByText('cert_inc.pdf')).toBeTruthy();
  dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove document' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.delete).toHaveBeenCalledTimes(2);
});

it('refuses a foreign upload receipt without closing the selected file or caching a document', async () => {
  company.isOwner = false;
  prepareCompanyClient(client, 'investor');
  api.post.mockResolvedValue({
    data: { ...documentRecord('cert_inc', 'wrong-receipt'), company: 'foreign-company', name: 'incorporation.pdf' },
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Upload Certificate of Incorporation' }));
  const dialog = screen.getByRole('dialog');
  const file = new File(['private synthetic bytes'], 'incorporation.pdf', { type: 'application/pdf' });
  fireEvent.change(within(dialog).getByLabelText('Document file'), { target: { files: [file] } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
  expect(await within(dialog).findByText(/upload outcome could not be confirmed/)).toBeTruthy();
  expect(within(dialog).getByText(file.name)).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();
});

it.each(['owner', 'role'])(
  'keeps the class draft disabled after list-only %s loss with administration retained',
  async (mode) => {
    show();
    const dialog = await createForm();
    fireEvent.change(within(dialog).getByLabelText('Authorised shares'), { target: { value: '1000' } });
    if (mode === 'owner') {
      company = { ...company, isOwner: false };
      await act(async () => client.invalidateQueries({ queryKey: ['companies'] }));
    } else act(() => prepareCompanyClient(client, 'investor'));
    const confirm = within(dialog).getByRole('button', { name: 'Create share class' }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect((within(dialog).getByLabelText('Authorised shares') as HTMLInputElement).value).toBe('1000');
    expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Activation' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Published to your members' })).toBeNull();
    fireEvent.click(confirm);
    expect(api.post).not.toHaveBeenCalled();
  },
);

it('retains an edit draft and owner business while list-only administration loss hides private records', async () => {
  company.documents = [documentRecord('cert_inc')];
  show();
  await screen.findByRole('link', { name: 'View cert_inc.pdf' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit company' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  company = { ...company, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(async () => client.invalidateQueries({ queryKey: ['companies'] }));
  const confirm = within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(true));
  expect((within(dialog).getByLabelText('Phone') as HTMLInputElement).value).toBe('12345');
  expect(screen.queryByText('company@example.invalid')).toBeNull();
  expect(screen.queryByText('cert_inc.pdf')).toBeNull();
  expect(screen.queryByRole('link', { name: 'View cert_inc.pdf' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Activation' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Representative authority' })).toBeTruthy();
  expect(screen.getByText('Current company administration is required to access company documents.')).toBeTruthy();
  fireEvent.click(confirm);
  expect(api.patch).not.toHaveBeenCalled();
});

it('closes a private removal confirmation after list-only administration loss on the retained owner company', async () => {
  company.documents = [documentRecord('cert_inc')];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove cert_inc.pdf' }));
  const dialog = screen.getByRole('dialog');
  const button = within(dialog).getByRole('button', { name: 'Remove document' });
  const props = Object.entries(button).find(([key]) => key.startsWith('__reactProps$'))?.[1] as
    { onClick: () => void } | undefined;
  const confirm = props?.onClick;
  expect(typeof confirm).toBe('function');
  const administrativeAccess = company.administrativeAccess;
  company = { ...company, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(async () => client.invalidateQueries({ queryKey: ['companies'] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(/Remove cert_inc.pdf from/)).toBeNull();
  expect(screen.queryByRole('link', { name: 'View cert_inc.pdf' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Activation' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Representative authority' })).toBeTruthy();
  expect(api.delete).not.toHaveBeenCalled();
  company = { ...company, administrativeAccess };
  await act(async () => client.invalidateQueries({ queryKey: ['companies'] }));
  await screen.findByRole('link', { name: 'View cert_inc.pdf' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => confirm!());
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove cert_inc.pdf' }));
  const next = screen.getByRole('dialog');
  expect((within(next).getByRole('button', { name: 'Remove document' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => confirm!());
  expect(api.delete).not.toHaveBeenCalled();
  api.delete.mockImplementationOnce(async () => {
    company = { ...company, documents: [] };
    return { status: 204 };
  });
  fireEvent.click(within(next).getByRole('button', { name: 'Remove document' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('retains a disabled local upload draft after list-only administration loss without showing cached private records', async () => {
  company.documents = [documentRecord('cert_inc')];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Upload Other documents' }));
  const dialog = screen.getByRole('dialog');
  const file = new File(['synthetic local bytes'], 'local-draft.pdf', { type: 'application/pdf' });
  fireEvent.change(within(dialog).getByLabelText('Document file'), { target: { files: [file] } });
  company = { ...company, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(async () => client.invalidateQueries({ queryKey: ['companies'] }));
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByText(file.name)).toBeTruthy();
  const confirm = within(dialog).getByRole('button', { name: 'Upload' }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(true));
  expect(screen.queryByText('cert_inc.pdf')).toBeNull();
  fireEvent.click(confirm);
  expect(api.post).not.toHaveBeenCalled();
});
