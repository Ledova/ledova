// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Company } from '@ledova/shared';
import CompanyPage from '.';
import { companyPreferences, companyRecord, documentRecord, renderCompanyPage } from './testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const dialogs = vi.hoisted(() => ({ current: {} as Record<string, { onConfirm: () => void; onClose: () => void }> }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@components/Modal', () => ({
  Modal: (props: {
    title: string;
    isOpen: boolean;
    children: ReactNode;
    onConfirm: () => void;
    onClose: () => void;
    confirmLabel: string;
    confirmDisabled?: boolean;
  }) => {
    dialogs.current[props.title] = props;
    return props.isOpen ? (
      <div role="dialog" aria-label={props.title}>
        {props.children}
        <button onClick={props.onClose}>Cancel</button>
        <button disabled={props.confirmDisabled} onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    ) : null;
  },
}));

let client: QueryClient;
let company: Company;
const COMPANY = '/api/v1/companies/company-one/';
beforeEach(() => {
  vi.resetAllMocks();
  dialogs.current = {};
  company = companyRecord();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/auth/verify/') return { data: { valid: true } };
    if (url === '/api/user-preferences/') return { data: companyPreferences() };
    if (url === '/api/v1/companies/') return { data: { results: [company] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === '/api/v1/tokens/') return { data: { results: [] } };
    throw new Error(`Unexpected read: ${url}`);
  });
  api.patch.mockImplementation(async (_url, changes) => {
    company = { ...company, ...changes };
    return { data: { ...company } };
  });
  api.post.mockImplementation(async (_url, form) => ({
    data: { ...documentRecord('cert_inc', 'new-document'), name: form.get('name') },
  }));
  api.delete.mockImplementation(async () => {
    company = { ...company, documents: [] };
    return { status: 204 };
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function show() {
  return renderCompanyPage(client, <CompanyPage />, 'Company');
}

it('retires a closed edit callback even after another draft for the same company opens', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Phone'), { target: { value: '12345' } });
  const old = dialogs.current['Edit company']!;
  act(() => old.onClose());
  fireEvent.click(screen.getByRole('button', { name: 'Edit company' }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Phone'), { target: { value: '54321' } });
  await act(async () => old.onConfirm());
  expect(api.patch).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
  expect(api.patch.mock.calls[0][1]).toEqual({ phone: '54321' });
});

it('retires a closed upload callback without consuming the new selected file', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Upload Certificate of Incorporation' }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Document file'), {
    target: { files: [new File(['old'], 'old.pdf', { type: 'application/pdf' })] },
  });
  const old = dialogs.current['Upload Certificate of Incorporation']!;
  act(() => old.onClose());
  fireEvent.click(screen.getByRole('button', { name: 'Upload Certificate of Incorporation' }));
  const file = new File(['current'], 'current.pdf', { type: 'application/pdf' });
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Document file'), { target: { files: [file] } });
  await act(async () => old.onConfirm());
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect(api.post.mock.calls[0][1].get('file')).toBe(file);
});

it('retires a cancelled document confirmation after the same document is reopened', async () => {
  company.documents = [documentRecord('cert_inc')];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove cert_inc.pdf' }));
  const old = dialogs.current['Remove company document?']!;
  act(() => old.onClose());
  fireEvent.click(screen.getByRole('button', { name: 'Remove cert_inc.pdf' }));
  await act(async () => old.onConfirm());
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove document' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
});
