// @vitest-environment jsdom

import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_ALLOTMENT_COPY as COPY,
  type RegisterAllotment,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { APPOINTMENT, REGISTER } from '../../../../../packages/shared/tests/fixtures/employee-awards';
import {
  ALLOTMENT_REQUEST,
  allotmentFrom,
  allotmentDecision,
  allotmentPreview,
} from '../../../../../packages/shared/tests/fixtures/external-allotments';
import { ClassAllotments } from './ClassAllotments';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const save = vi.hoisted(() => vi.fn());
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('./useCompanyRegister', async (original) => ({ ...(await original<object>()), saveFile: save }));
const owner = { userUuid: 'profile-one', ownerAccountUuid: 'account-one' };
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let pendingFileRelease: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    pendingFileRelease?.();
  });
  pendingFileRelease = undefined;
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('recovers a company-recorded allotment without duplicate preparation, then approves/applies it and hides private records after authority loss', async () => {
  let rows: RegisterAllotment[] = [];
  let appointments: OwnCompanyAppointment[] = [APPOINTMENT];
  let failedRead = false;
  let releaseFile: (() => void) | undefined;
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_ALLOTMENTS) {
      if (failedRead)
        throw Object.assign(new Error('Synthetic authoritative read refused'), { response: { status: 404 } });
      return { data: { results: rows, next: null } };
    }
    if (rows[0] && url === URLS.REGISTER_ALLOTMENT_RECEIPT_FILE(rows[0].uuid))
      return new Promise((resolve) => {
        releaseFile = () => resolve({ data: new Blob(['synthetic receipt']) });
        pendingFileRelease = releaseFile;
      });
    if (rows[0] && url === URLS.REGISTER_ALLOTMENT(rows[0].uuid)) return { data: rows[0] };
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) {
      const form = body as FormData;
      const file = form.get('file') as File;
      return {
        data: {
          uuid: `evidence-${form.get('idempotency_key')}`,
          company: form.get('company_id'),
          appointment: form.get('appointment'),
          kind: form.get('kind'),
          idempotencyKey: form.get('idempotency_key'),
          fileSize: file.size,
          sha256: 'a'.repeat(64),
          providedBy: 'company',
        },
      };
    }
    if (url === URLS.REGISTER_ALLOTMENTS) {
      rows = [allotmentFrom(body)];
      throw new Error('Synthetic interrupted preparation response');
    }
    if (url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid))
      return { data: allotmentPreview(rows[0], body.kind === 'apply') };
    if (url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid)) {
      rows = [allotmentDecision(rows[0], body)];
      return { data: rows[0] };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  render(
    <QueryClientProvider client={client}>
      <ClassAllotments owner={owner} company={APPOINTMENT.company} register={REGISTER} guard={() => {}} />
    </QueryClientProvider>,
  );
  const open = await screen.findByRole('button', { name: COPY.PREPARE });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  for (const [label, value] of [
    ['Investor name', ALLOTMENT_REQUEST.name!],
    ['Residential address', ALLOTMENT_REQUEST.residentialAddress!],
    [COPY.SHARES, '100'],
    [COPY.CONSIDERATION, '250'],
    [COPY.RECEIVED_AMOUNT, '249'],
    [COPY.AGREEMENT_REFERENCE, ALLOTMENT_REQUEST.agreementReference],
    [COPY.AGREEMENT_ON, ALLOTMENT_REQUEST.agreementOn],
    [COPY.RECEIVED_ON, ALLOTMENT_REQUEST.receivedOn],
    [COPY.TERMS, ALLOTMENT_REQUEST.terms],
    [COPY.DIRECTOR, ALLOTMENT_REQUEST.approvingDirector],
    [COPY.AUTHORITY_REFERENCE, ALLOTMENT_REQUEST.authorityReference],
    [COPY.REASON, ALLOTMENT_REQUEST.reason],
  ])
    fireEvent.change(await screen.findByLabelText(label), { target: { value } });
  for (const label of Object.values(COPY.DOCUMENTS))
    fireEvent.change(screen.getByLabelText(label), {
      target: { files: [new File(['synthetic'], 'evidence.pdf', { type: 'application/pdf' })] },
    });
  expect((screen.getByRole('button', { name: COPY.SUBMIT }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(COPY.RECEIVED_AMOUNT), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: COPY.SUBMIT }));
  await screen.findByRole('alert');
  expect(rows[0].registerEntry).toBeNull();
  expect(screen.getByLabelText(COPY.CONSIDERATION).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Close allotment form' })).toBeNull());
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  for (const kind of ['approve', 'apply'] as const) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]} \\(allotment`) }));
    const confirm = await screen.findByRole('button', { name: `${COPY.DECISIONS[kind]} external allotment` });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(rows[0].decisions).toHaveLength(kind === 'approve' ? 1 : 2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (kind === 'approve') expect(rows[0].registerEntry).toBeNull();
  }
  await screen.findByText('entry-a');
  expect(rows[0].registerEntry).toBe('entry-a');
  fireEvent.click(screen.getByRole('button', { name: /^Download receipt/ }));
  await waitFor(() => expect(releaseFile).toBeTypeOf('function'));
  failedRead = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh allotments' }));
  await screen.findByText(/External allotments could not be read/);
  expect(screen.queryByText('entry-a')).toBeNull();
  expect(screen.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(screen.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  await act(async () => {
    releaseFile!();
  });
  expect(save).not.toHaveBeenCalled();
  failedRead = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry allotments' }));
  await screen.findByText('entry-a');
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh allotments' }));
  await waitFor(() => expect(screen.queryByText('entry-a')).toBeNull());
  expect(screen.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
});
