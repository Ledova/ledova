// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COMPANY_TOKEN_ENDPOINTS, type Company } from '@ledova/shared';
import CompanyPage from '.';
import { companyRecord, renderCompanyPage } from './testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
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
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [{ uuid: company.uuid }] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === CLASSES) return { data: { ...EMPTY, count: 1, results: [shareClass] } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('shows company details, exact draft share classes and the class/application destinations', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(await screen.findByText('9,007,199,254,740,993 authorised shares')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Ordinary shares' }).getAttribute('href')).toBe(
    '/company/register/class-one',
  );
  expect(screen.getByRole('link', { name: 'Application' }).getAttribute('href')).toBe('/company/listing');
  expect(screen.getByRole('link', { name: 'Published to your members' }).getAttribute('href')).toBe(
    '/company/publications',
  );
  expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/company/register');
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
  expect(api.get.mock.calls.some(([url]) => String(url).includes('/stats/'))).toBe(false);
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
  expect(api.patch).toHaveBeenCalledWith(COMPANY, { phone: '12345' });
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
        expect(api.post).toHaveBeenCalledWith(CLASSES, {
          company: 'company-one',
          name: 'Ordinary shares',
          symbol: 'ORD',
          tokenType: 'ordinary',
          totalSupply: supply,
        }),
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
