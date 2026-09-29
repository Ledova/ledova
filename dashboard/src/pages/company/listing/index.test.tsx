// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { REQUIRED_DOCUMENTS, type Company } from '@ledova/shared';
import ListingPage from '.';
import { companyRecord, documentRecord, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const DOCUMENTS = COMPANY + 'documents/';
let client: QueryClient;
let company: Company;
let failed: string | null;
function show() {
  return renderCompanyPage(client, <ListingPage />, 'Application');
}
function fullDocuments() {
  company.documents = REQUIRED_DOCUMENTS.map(({ type }) => documentRecord(type));
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
    if (url === '/api/v1/companies/') return { data: { results: [{ uuid: company.uuid }] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === '/api/operator/') return { data: { name: 'Example Registry' } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('keeps the Application title and the way back to Company when no company exists', async () => {
  api.get.mockImplementation(async (url: string) => ({
    data: url === '/api/v1/companies/' ? { results: [] } : { name: 'Example Registry' },
  }));
  show();
  expect(await screen.findByText(/No company found/)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Application');
  fireEvent.click(screen.getByRole('button', { name: 'Back to Company' }));
  expect(await screen.findByText('Company page')).toBeTruthy();
});

it.each(['/api/v1/companies/', COMPANY])(
  'reports the failed %s read without claiming an absent company and retries',
  async (endpoint) => {
    failed = endpoint;
    show();
    const retry = await screen.findByRole('button', { name: 'Retry company information' });
    expect(screen.queryByText(/No company found/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
    failed = null;
    fireEvent.click(retry);
    expect(await screen.findByText(company.name)).toBeTruthy();
  },
);

it('uses every document from the complete company detail, including duplicate types and additional records', async () => {
  company.documents = Array.from({ length: 28 }, (_, index) =>
    documentRecord(index === 27 ? 'other' : 'cert_inc', `file-${index}`),
  );
  show();
  expect(await screen.findByText('file-0.pdf')).toBeTruthy();
  expect(screen.getByText('file-26.pdf')).toBeTruthy();
  expect(screen.getByText('file-27.pdf')).toBeTruthy();
  expect(api.get.mock.calls.map(([url]) => url)).toEqual(expect.not.arrayContaining([DOCUMENTS]));
  expect(screen.getByText('8 required documents still missing.')).toBeTruthy();
});

it('requires every required type before sending submission and refreshes the resulting state', async () => {
  show();
  const submit = (await screen.findByRole('button', { name: 'Submit application' })) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(api.post).not.toHaveBeenCalled();
  fullDocuments();
  await act(async () => client.invalidateQueries({ queryKey: ['company', company.uuid] }));
  await waitFor(() => expect(submit.disabled).toBe(false));
  api.post.mockImplementation(async () => {
    company = { ...company, status: 'submitted', statusDisplay: 'Submitted', submittedAt: '2026-09-02T00:00:00Z' };
    return { data: {} };
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  fireEvent.click(submit);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(COMPANY + 'submit/', { confirm: true }));
  expect(await screen.findByText(/waiting for Example Registry/)).toBeTruthy();
  expect(invalidate.mock.calls).toEqual([[{ queryKey: ['company'] }], [{ queryKey: ['companies'] }]]);
  expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
});

it.each(['draft', 'submitted', 'review', 'info_required', 'approved', 'active', 'rejected', 'withdrawn'] as const)(
  'preserves %s application action boundaries',
  async (status) => {
    company.status = status;
    company.statusDisplay = status;
    fullDocuments();
    show();
    await screen.findByText(company.name);
    expect(!!screen.queryByRole('button', { name: 'Submit application' })).toBe(status === 'draft');
    expect(!!screen.queryByRole('button', { name: 'Resubmit application' })).toBe(status === 'info_required');
    expect(!!screen.queryByRole('button', { name: 'Withdraw application' })).toBe(
      status === 'submitted' || status === 'info_required',
    );
    expect(!!screen.queryByRole('button', { name: 'Remove cert_inc.pdf' })).toBe(
      status === 'draft' || status === 'info_required',
    );
    expect(screen.getByText('cert_inc.pdf')).toBeTruthy();
  },
);

it('retains review evidence, recorded dates and a failed response for retry', async () => {
  company = companyRecord({
    status: 'info_required',
    statusDisplay: 'Information required',
    infoRequestReason: 'Provide a current extract.',
    additionalInfoResponse: 'Previous response',
    infoRequestedAt: '2026-09-03T00:00:00Z',
    submittedAt: '2026-09-01T00:00:00Z',
  });
  fullDocuments();
  api.post.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Explain the replacement document.' } } }),
  );
  show();
  expect(await screen.findByText('Provide a current extract.')).toBeTruthy();
  expect(screen.getByText('Previous response')).toBeTruthy();
  expect(screen.getByText('3 September 2026')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Response to the operator'), {
    target: { value: '  Replaced the extract  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resubmit application' }));
  expect(await screen.findByText('Explain the replacement document.')).toBeTruthy();
  expect((screen.getByLabelText('Response to the operator') as HTMLTextAreaElement).value).toBe(
    '  Replaced the extract  ',
  );
  expect(api.post).toHaveBeenCalledWith(COMPANY + 'resubmit/', { response: 'Replaced the extract' });
  fireEvent.click(screen.getByRole('button', { name: 'Resubmit application' }));
  await waitFor(() =>
    expect((screen.getByLabelText('Response to the operator') as HTMLTextAreaElement).value).toBe(''),
  );
});

it('preserves a response through failed reads and hides stale application actions until retry', async () => {
  company.status = 'info_required';
  fullDocuments();
  show();
  fireEvent.change(await screen.findByLabelText('Response to the operator'), {
    target: { value: 'Keep this response' },
  });
  failed = COMPANY;
  await act(async () => client.invalidateQueries({ queryKey: ['company', company.uuid] }));
  expect(await screen.findByRole('button', { name: 'Retry company information' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resubmit application' })).toBeNull();
  failed = null;
  fireEvent.click(screen.getByRole('button', { name: 'Retry company information' }));
  expect(((await screen.findByLabelText('Response to the operator')) as HTMLTextAreaElement).value).toBe(
    'Keep this response',
  );
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
  await act(async () => resolveUpload({ data: {} }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('blocks a prepared upload when the application enters review', async () => {
  show();
  const { dialog } = await openUpload();
  company.status = 'review';
  await act(async () => client.invalidateQueries({ queryKey: ['company', company.uuid] }));
  const submit = within(dialog).getByRole('button', { name: 'Upload' }) as HTMLButtonElement;
  await waitFor(() => expect(submit.disabled).toBe(true));
  fireEvent.click(submit);
  expect(api.post).not.toHaveBeenCalled();
  expect(within(dialog).getByText('incorporation.pdf')).toBeTruthy();
});

it('shows the latest action refusal instead of an older submission failure', async () => {
  fullDocuments();
  api.post.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Submission was refused.' } } }),
  );
  api.delete.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Removal was refused.' } } }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Submit application' }));
  expect(await screen.findByText('Submission was refused.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove cert_inc.pdf' }));
  expect(await screen.findByText('Removal was refused.')).toBeTruthy();
  expect(screen.queryByText('Submission was refused.')).toBeNull();
});

it('shows removal failure without losing the document, and refreshes after successful retry', async () => {
  company.documents = [documentRecord('cert_inc')];
  api.delete.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Document is retained for review.' } } }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove cert_inc.pdf' }));
  expect(await screen.findByText('Document is retained for review.')).toBeTruthy();
  expect(screen.getByText('cert_inc.pdf')).toBeTruthy();
  api.delete.mockImplementation(async () => {
    company.documents = [];
    return {};
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove cert_inc.pdf' }));
  await waitFor(() => expect(screen.queryByText('cert_inc.pdf')).toBeNull());
  expect(api.delete).toHaveBeenCalledWith(DOCUMENTS + 'cert_inc/');
});

it('retains a withdrawal reason after refusal and disables the draft when review begins', async () => {
  company.status = 'submitted';
  api.post.mockRejectedValueOnce(
    Object.assign(new Error('HTTP 400'), { response: { data: { detail: 'Try again later.' } } }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw application' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), {
    target: { value: 'Correcting our application' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw application' }));
  expect(await within(dialog).findByText('Try again later.')).toBeTruthy();
  expect((within(dialog).getByLabelText('Reason (optional)') as HTMLTextAreaElement).value).toBe(
    'Correcting our application',
  );
  company.status = 'review';
  await act(async () => client.invalidateQueries({ queryKey: ['company', company.uuid] }));
  await waitFor(() =>
    expect((within(dialog).getByRole('button', { name: 'Withdraw application' }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw application' }));
  expect(api.post).toHaveBeenCalledTimes(1);
});

it.each(['rejected', 'withdrawn'] as const)('shows a recorded %s outcome and reason', async (status) => {
  company = companyRecord({
    status,
    statusDisplay: status,
    rejectionReason: status === 'rejected' ? 'Missing authority.' : '',
    withdrawalReason: status === 'withdrawn' ? 'Correcting our application.' : '',
  });
  show();
  expect(
    await screen.findByText(
      status === 'rejected' ? 'Rejection reason: Missing authority.' : 'Withdrawal reason: Correcting our application.',
    ),
  ).toBeTruthy();
});
