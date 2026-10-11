import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_ALLOTMENT_COPY as COPY,
  type RegisterAllotment,
  type OwnCompanyAppointment,
  type RegisterAllotmentPreparation,
  type RegisterAllotmentDecideRequest,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { APPOINTMENT, REGISTER } from '../../../../packages/shared/tests/fixtures/employee-awards';
import {
  ALLOTMENT_REQUEST,
  allotmentFrom,
  allotmentDecision,
  allotmentPreview,
} from '../../../../packages/shared/tests/fixtures/external-allotments';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { ClassAllotments } from './ClassAllotments';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
});
let pendingFileRelease: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    pendingFileRelease?.();
  });
  pendingFileRelease = undefined;
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('recovers the fully paid company allotment once, separates approval from ISSUE and hides private sources after appointment loss', async () => {
  resetFiles();
  let keys = 0;
  let picks = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(
      () => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}` as ReturnType<typeof Crypto.randomUUID>,
    );
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementation(async () => pickedFile(++picks));
  const append = jest.spyOn(FormData.prototype, 'append');
  const field = (form: unknown, key: string) =>
    append.mock.calls.filter((_, index) => append.mock.contexts[index] === form).find(([name]) => name === key)?.[1];
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  let rows: RegisterAllotment[] = [];
  let appointments: OwnCompanyAppointment[] = [APPOINTMENT];
  let failedRead = false;
  let releaseFile: (() => void) | undefined;
  get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_ALLOTMENTS) {
      if (failedRead)
        throw Object.assign(new Error('Synthetic authoritative read refused'), { response: { status: 404 } });
      return { data: { results: rows, next: null } };
    }
    if (rows[0] && url === URLS.REGISTER_ALLOTMENT_RECEIPT_FILE(rows[0].uuid))
      return new Promise((resolve) => {
        releaseFile = () =>
          resolve({ data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } });
        pendingFileRelease = releaseFile;
      });
    if (rows[0] && url === URLS.REGISTER_ALLOTMENT(rows[0].uuid)) return { data: rows[0] };
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE)
      return {
        data: {
          uuid: `evidence-${field(body, 'idempotency_key')}`,
          company: field(body, 'company_id'),
          appointment: field(body, 'appointment'),
          kind: field(body, 'kind'),
          idempotencyKey: field(body, 'idempotency_key'),
          fileSize: 5,
          sha256: 'a'.repeat(64),
          providedBy: 'company',
        },
      };
    if (url === URLS.REGISTER_ALLOTMENTS) {
      rows = [allotmentFrom(body as RegisterAllotmentPreparation)];
      throw new Error('Synthetic interrupted preparation response');
    }
    if (url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid))
      return { data: allotmentPreview(rows[0], (body as { kind: string }).kind === 'apply') };
    if (url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid)) {
      rows = [allotmentDecision(rows[0], body as RegisterAllotmentDecideRequest)];
      return { data: rows[0] };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <ClassAllotments company={APPOINTMENT.company} register={REGISTER} epoch={getSessionEpoch()} sourceReady />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  const open = await view.findByRole('button', { name: COPY.PREPARE });
  await waitFor(() => expect(open).not.toBeDisabled());
  await fireEvent.press(open);
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
    await fireEvent.changeText(await view.findByLabelText(label), value);
  for (const noun of ['authority document', 'agreement document', 'receipt evidence']) {
    await fireEvent.press(view.getByRole('button', { name: `Choose the ${noun}` }));
    await view.findByRole('button', { name: `Replace the ${noun}` });
  }
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText(COPY.RECEIVED_AMOUNT), '250');
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByRole('alert');
  expect(rows[0].registerEntry).toBeNull();
  expect(view.getByLabelText(COPY.CONSIDERATION).props.editable).toBe(false);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Close allotment form' })).toBeNull());
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  for (const kind of ['approve', 'apply'] as const) {
    await fireEvent.press(
      view.getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]} the external allotment`) }),
    );
    const confirm = await view.findByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    await fireEvent.press(confirm);
    await waitFor(() => expect(rows[0].decisions).toHaveLength(kind === 'approve' ? 1 : 2));
    await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
    if (kind === 'approve') expect(rows[0].registerEntry).toBeNull();
  }
  await view.findByText('entry-a');
  await fireEvent.press(view.getByRole('button', { name: /^Download receipt/ }));
  await waitFor(() => expect(releaseFile).toBeDefined());
  failedRead = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh allotments' }));
  await view.findByText(/External allotments could not be read/);
  expect(view.queryByText('entry-a')).toBeNull();
  expect(view.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(view.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  await act(async () => {
    releaseFile!();
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  failedRead = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry allotments' }));
  await view.findByText('entry-a');
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh allotments' }));
  await waitFor(() => expect(view.queryByText('entry-a')).toBeNull());
  expect(view.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
});
