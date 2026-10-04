// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Company } from '@ledova/shared';
import { companyRecord, documentRecord, renderCompanyPage } from './testSupport';
import { CompanyDocuments } from './CompanyDocuments';
import { useCompany } from './hooks/useCompany';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const DOCUMENTS = COMPANY + 'documents/';
let client: QueryClient;
let company: Company;
let failed: string | null;
function DocumentPage() {
  const read = useCompany();
  const query = useQueryClient();
  return (
    read.retainedCompany && (
      <CompanyDocuments
        company={read.retainedCompany}
        read={read}
        editable={read.canAdmin}
        refresh={() =>
          Promise.all([
            query.invalidateQueries({ queryKey: read.companyKey }),
            query.invalidateQueries({ queryKey: read.companiesKey }),
          ])
        }
      />
    )
  );
}
function show() {
  return renderCompanyPage(client, <DocumentPage />, 'Company');
}
async function openUpload() {
  fireEvent.click(await screen.findByRole('button', { name: 'Upload Certificate of Incorporation' }));
  const dialog = await screen.findByRole('dialog');
  const file = new File(['Synthetic document bytes'], 'incorporation.pdf', { type: 'application/pdf' });
  fireEvent.change(within(dialog).getByLabelText('Document file'), { target: { files: [file] } });
  return { dialog, file };
}
beforeEach(() => {
  vi.resetAllMocks();
  failed = null;
  company = companyRecord();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { results: [company] } };
    if (url === COMPANY) return { data: { ...company } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockImplementation(async (_url, form) => ({
    data: { ...documentRecord('cert_inc', 'uploaded-document'), name: form.get('name') },
  }));
  api.delete.mockResolvedValue({ status: 204 });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('uses every document from the complete company detail, including duplicate types and additional records', async () => {
  company.documents = Array.from({ length: 28 }, (_, index) =>
    documentRecord(index === 27 ? 'other' : 'cert_inc', `file-${index}`),
  );
  show();
  expect(await screen.findByText('file-0.pdf')).toBeTruthy();
  expect(screen.getByText('file-26.pdf')).toBeTruthy();
  expect(screen.getByText('file-27.pdf')).toBeTruthy();
  expect(api.get.mock.calls.map(([url]) => url)).toEqual(expect.not.arrayContaining([DOCUMENTS]));
});

it('keeps the selected File through upload refusal and a failed company refresh, then posts the same bytes', async () => {
  api.post.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Please supply a legible copy.' } } }),
  );
  show();
  const { dialog, file } = await openUpload();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
  expect(await within(dialog).findByText('Please supply a legible copy.')).toBeTruthy();
  expect(within(dialog).getByText('incorporation.pdf')).toBeTruthy();
  failed = COMPANY;
  await act(async () => client.invalidateQueries({ queryKey: ['company', company.uuid] }));
  expect(screen.getByRole('dialog')).toBe(dialog);
  const submit = within(dialog).getByRole('button', { name: 'Upload' }) as HTMLButtonElement;
  await waitFor(() => expect(submit.disabled).toBe(true));
  fireEvent.click(submit);
  expect(api.post).toHaveBeenCalledTimes(1);
  failed = null;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry company information' }));
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  const payload = api.post.mock.calls[1][1] as FormData;
  expect(payload.get('file')).toBe(file);
  expect(payload.get('document_type')).toBe('cert_inc');
  expect(payload.get('name')).toBe('incorporation.pdf');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps an in-flight upload open through Escape and outside clicks and avoids a duplicate POST', async () => {
  let resolveUpload: (value: unknown) => void = () => {};
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  show();
  const { dialog } = await openUpload();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
  await within(dialog).findByRole('button', { name: 'Loading...' });
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
  });
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByText('incorporation.pdf')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Loading...' }));
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolveUpload({ data: { ...documentRecord('cert_inc', 'uploaded-document'), name: 'incorporation.pdf' } }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('shows removal failure without losing the document, and refreshes after successful retry', async () => {
  company.documents = [documentRecord('cert_inc')];
  api.delete.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Document is retained for review.' } } }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove cert_inc.pdf' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove document' }));
  expect(await screen.findByText('Document is retained for review.')).toBeTruthy();
  expect(screen.getByText('cert_inc.pdf')).toBeTruthy();
  api.delete.mockImplementation(async () => {
    company.documents = [];
    return { status: 204 };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove document' }));
  await waitFor(() => expect(screen.queryByText('cert_inc.pdf')).toBeNull());
  expect(api.delete).toHaveBeenCalledWith(
    DOCUMENTS + 'cert_inc/',
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
});
