// @vitest-environment jsdom

import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_ALLOTMENT_COPY as COPY,
  type RegisterAllotment,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { APPOINTMENT, REGISTER } from '../../../../../packages/shared/tests/fixtures/employee-awards';
import {
  ALLOTMENT_REQUEST,
  allotmentFrom,
  allotmentDecision,
  allotmentPreview,
} from '../../../../../packages/shared/tests/fixtures/external-allotments';
import CompanyRegisterPage from '.';
import { companyPreferences, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const save = vi.hoisted(() => vi.fn());
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('./useCompanyRegister', async (original) => ({ ...(await original<object>()), saveFile: save }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let pendingFileRelease: (() => void) | undefined;
let pendingReadRelease: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    pendingFileRelease?.();
    pendingReadRelease?.();
  });
  pendingFileRelease = undefined;
  pendingReadRelease = undefined;
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('preserves original preparation and issue recovery through refresh, keeps approval separate and hides private records on failed source or authority reads', async () => {
  let rows: RegisterAllotment[] = [];
  let appointments: OwnCompanyAppointment[] = [APPOINTMENT];
  let failedRead = false;
  let interruptedAbsentPreparation = false;
  let absentPreparation: Record<string, unknown> | null = null;
  let pauseRead = false;
  let releaseRead: (() => void) | undefined;
  let releaseFile: (() => void) | undefined;
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') {
      return { data: companyPreferences() };
    }
    if (url === URLS.REGISTER) {
      return {
        data: {
          results: [
            { uuid: REGISTER.token.uuid, companyUuid: APPOINTMENT.company, companyName: APPOINTMENT.companyName },
          ],
          next: null,
        },
      };
    }
    if (url === URLS.HOLDERS(REGISTER.token.uuid))
      return {
        data: rows[0]?.registerEntry
          ? {
              ...REGISTER,
              issuedSupply: rows[0].shares,
              totalHolders: 1,
              holders: [
                {
                  member: rows[0].member,
                  name: rows[0].name,
                  holderType: 'member',
                  balance: rows[0].shares,
                  shareClass: REGISTER.token.name,
                  source: 'register',
                  identitySource: 'company_recorded',
                  enteredOn: rows[0].effectiveOn,
                  percentage: 100,
                  wallets: [],
                },
              ],
            }
          : REGISTER,
      };
    if (url === URLS.REGISTER_LINK_WAITING_WALLETS) return { data: { wallets: [] } };
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_ALLOTMENTS) {
      if (pauseRead)
        return new Promise((resolve, reject) => {
          releaseRead = () =>
            failedRead
              ? reject(Object.assign(new Error('Synthetic authoritative read refused'), { response: { status: 404 } }))
              : resolve({ data: { results: rows, next: null } });
          pendingReadRelease = releaseRead;
        });
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
    if (absentPreparation && url === URLS.REGISTER_ALLOTMENT(String(absentPreparation.operationId)))
      throw Object.assign(new Error('Original preparation absent'), { response: { status: 404 } });
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [] } };
    if (url.startsWith('/api/v1/tokens/')) return { data: { results: [], next: null } };
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
      if (interruptedAbsentPreparation) {
        if (!absentPreparation) {
          absentPreparation = body;
          throw new Error('Synthetic interrupted request before preparation commit');
        }
        throw Object.assign(new Error('Original preparation appointment refused'), { response: { status: 404 } });
      }
      rows = [allotmentFrom(body)];
      throw new Error('Synthetic interrupted preparation response');
    }
    if (url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid))
      return { data: allotmentPreview(rows[0], body.kind === 'apply') };
    if (url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid)) {
      const repeated = rows[0].decisions.some((decision) => decision.idempotencyKey === body.idempotencyKey);
      if (!repeated) rows = [allotmentDecision(rows[0], body)];
      if (body.kind === 'apply' && !repeated) throw new Error('Synthetic interrupted issue response');
      return { data: rows[0] };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  renderCompanyPage(client, <CompanyRegisterPage />, 'Register');
  const allotments = within((await screen.findByRole('heading', { name: COPY.TITLE })).parentElement!);
  const open = await allotments.findByRole('button', { name: COPY.PREPARE });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  expect(await allotments.findByRole('group', { name: '1. Person and shares' })).toBeTruthy();
  expect(allotments.getByRole('group', { name: '2. Agreement and company receipt' })).toBeTruthy();
  expect(allotments.getByRole('group', { name: '3. Company authority and review' })).toBeTruthy();
  const fillForm = (receivedAmount = '249') => {
    act(() => {
      for (const [label, value] of [
        ['Investor name', ALLOTMENT_REQUEST.name!],
        ['Residential address', ALLOTMENT_REQUEST.residentialAddress!],
        [COPY.SHARES, '100'],
        [COPY.CONSIDERATION, '250'],
        [COPY.RECEIVED_AMOUNT, receivedAmount],
        [COPY.AGREEMENT_REFERENCE, ALLOTMENT_REQUEST.agreementReference],
        [COPY.AGREEMENT_ON, ALLOTMENT_REQUEST.agreementOn],
        [COPY.RECEIVED_ON, ALLOTMENT_REQUEST.receivedOn],
        [COPY.TERMS, ALLOTMENT_REQUEST.terms],
        [COPY.DIRECTOR, ALLOTMENT_REQUEST.approvingDirector],
        [COPY.AUTHORITY_REFERENCE, ALLOTMENT_REQUEST.authorityReference],
        [COPY.REASON, ALLOTMENT_REQUEST.reason],
      ])
        fireEvent.change(allotments.getByLabelText(label), { target: { value } });
      for (const label of Object.values(COPY.DOCUMENTS))
        fireEvent.change(allotments.getByLabelText(label), {
          target: { files: [new File(['synthetic'], 'evidence.pdf', { type: 'application/pdf' })] },
        });
    });
  };
  fillForm();
  expect((allotments.getByRole('button', { name: COPY.SUBMIT }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(allotments.getByLabelText(COPY.RECEIVED_AMOUNT), { target: { value: '250' } });
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByRole('alert');
  expect(rows[0].registerEntry).toBeNull();
  expect(allotments.getByLabelText(COPY.CONSIDERATION).matches(':disabled')).toBe(true);
  failedRead = true;
  fireEvent.click(allotments.getByRole('button', { name: 'Refresh allotments' }));
  await allotments.findByText(/External allotments could not be read/);
  expect(allotments.queryByLabelText('Investor name')).toBeNull();
  failedRead = false;
  fireEvent.click(allotments.getByRole('button', { name: 'Retry allotments' }));
  await allotments.findByLabelText('Investor name');
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(allotments.queryByRole('button', { name: 'Close allotment form' })).toBeNull());
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(allotments.queryByRole('button', { name: /^Record issue [(]allotment/ })).toBeNull();
  for (const kind of ['approve', 'apply'] as const) {
    const label = kind === 'apply' ? 'Record issue' : COPY.DECISIONS[kind];
    fireEvent.click(allotments.getByRole('button', { name: new RegExp(`^${label} \\(allotment`) }));
    const dialog = await screen.findByRole('dialog', { name: `${label} external allotment` });
    const confirm = within(dialog).getByRole('button', { name: `${label} external allotment` });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(rows[0].decisions).toHaveLength(kind === 'approve' ? 1 : 2));
    if (kind === 'approve') {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(rows[0].registerEntry).toBeNull();
      await allotments.findByText('Next: record the approved share issue. Approval has not changed ownership.');
    }
  }
  await allotments.findByRole('button', { name: /^Recover record issue receipt/ });
  pauseRead = true;
  failedRead = true;
  fireEvent.click(allotments.getByRole('button', { name: 'Refresh allotments' }));
  await waitFor(() => expect(releaseRead).toBeTypeOf('function'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.name);
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.residentialAddress);
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.agreementReference);
  expect(allotments.queryByRole('button', { name: /^Recover record issue receipt/ })).toBeNull();
  await act(async () => releaseRead!());
  pendingReadRelease = undefined;
  await allotments.findByText(/External allotments could not be read/);
  expect(allotments.queryByText('entry-a')).toBeNull();
  pauseRead = false;
  failedRead = false;
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  fireEvent.click(allotments.getByRole('button', { name: 'Retry allotments' }));
  const recover = await allotments.findByRole('button', { name: /^Recover record issue receipt/ });
  const shareSummary = await screen.findByRole('region', { name: `${REGISTER.token.name} share summary` });
  expect(within(shareSummary).getByText('100')).toBeTruthy();
  expect(within(shareSummary).getByText('1')).toBeTruthy();
  expect(allotments.queryByRole('button', { name: /^Record issue [(]allotment/ })).toBeNull();
  expect(recover).toBeTruthy();
  fireEvent.click(await allotments.findByRole('button', { name: /^Recover record issue receipt/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await allotments.findByText('Shares issued');
  const originalIssues = api.post.mock.calls.filter(
    ([url, body]) => url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid) && body.kind === 'apply',
  );
  expect(originalIssues).toHaveLength(2);
  expect(originalIssues[1][1]).toEqual(originalIssues[0][1]);
  expect(
    api.post.mock.calls.filter(
      ([url, body]) => url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid) && body.kind === 'apply',
    ),
  ).toHaveLength(1);
  expect(rows[0].decisions).toHaveLength(2);
  fireEvent.click(allotments.getByText('Record details and documents'));
  await allotments.findByText('entry-a');
  expect(rows[0].registerEntry).toBe('entry-a');
  fireEvent.click(allotments.getByRole('button', { name: /^Download receipt/ }));
  await waitFor(() => expect(releaseFile).toBeTypeOf('function'));
  failedRead = true;
  fireEvent.click(allotments.getByRole('button', { name: 'Refresh allotments' }));
  await allotments.findByText(/External allotments could not be read/);
  expect(allotments.queryByText('entry-a')).toBeNull();
  expect(allotments.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(allotments.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  await act(async () => releaseFile!());
  pendingFileRelease = undefined;
  expect(save).not.toHaveBeenCalled();
  failedRead = false;
  fireEvent.click(allotments.getByRole('button', { name: 'Retry allotments' }));
  await allotments.findByText('Shares issued');
  expect(allotments.getByText('entry-a')).toBeTruthy();
  expect(allotments.getByText(ALLOTMENT_REQUEST.agreementReference)).toBeTruthy();
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  fireEvent.click(allotments.getByRole('button', { name: 'Refresh allotments' }));
  await waitFor(() => expect(allotments.queryByText('entry-a')).toBeNull());
  expect(allotments.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(allotments.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  interruptedAbsentPreparation = true;
  appointments = [APPOINTMENT];
  fireEvent.click(allotments.getByRole('button', { name: 'Refresh allotments' }));
  fireEvent.click(await allotments.findByRole('button', { name: COPY.PREPARE }));
  await allotments.findByLabelText('Investor name');
  fillForm('250');
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByText(COPY.PREPARATION_RECEIPT_FAILED);
  appointments = [{ ...APPOINTMENT, uuid: 'replacement-preparation-appointment' }];
  fireEvent.click(allotments.getByRole('button', { name: 'Refresh allotments' }));
  await allotments.findByLabelText('Investor name');
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByText(
    'The original allotment was not recorded and the request was refused. Close this form and start again with current company authority.',
  );
  const refusedPreparations = api.post.mock.calls.filter(
    ([url, body]) => url === URLS.REGISTER_ALLOTMENTS && body.operationId === absentPreparation?.operationId,
  );
  expect(refusedPreparations).toHaveLength(2);
  expect(refusedPreparations[1][1]).toEqual(refusedPreparations[0][1]);
  expect(refusedPreparations[1][1].appointment).toBe(APPOINTMENT.uuid);
  expect(
    api.get.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENT(String(absentPreparation?.operationId))),
  ).toHaveLength(2);
  const close = allotments.getByRole('button', { name: 'Close allotment form' });
  await waitFor(() => expect(close.matches(':disabled')).toBe(false));
  fireEvent.click(close);
  expect(rows[0].registerEntry).toBe('entry-a');
  expect(rows[0].decisions).toHaveLength(2);
});
