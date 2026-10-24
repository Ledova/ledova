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
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { registerKey } from '../../hooks/useCompanyRegister';

let mockSection = 'issue';
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { section: mockSection } }),
  useNavigation: () => ({
    navigate: jest.fn(),
    setParams: (params: { section: string }) => {
      mockSection = params.section;
    },
  }),
}));

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

it('recovers the fully paid company allotment once, approves and issues it in one recovered decision and hides private sources after appointment loss', async () => {
  mockSection = 'issue';
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
  const preferences = { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } };
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let rows: RegisterAllotment[] = [];
  let appointments: OwnCompanyAppointment[] = [APPOINTMENT];
  let failedRead = false;
  let listed = true;
  let failedPreferences = false;
  let interruptedIssue = false;
  const listedClass = {
    uuid: REGISTER.token.uuid,
    name: REGISTER.token.name,
    symbol: REGISTER.token.symbol!,
    companyUuid: APPOINTMENT.company,
    companyName: APPOINTMENT.companyName,
  };
  let releaseFile: (() => void) | undefined;
  let incompleteImpact = false;
  let staleApproval = true;
  get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') {
      if (failedPreferences) throw new Error('Synthetic preferences unavailable');
      return { data: preferences };
    }
    if (url === URLS.REGISTER)
      return {
        data: {
          results: listed
            ? [listedClass]
            : [{ ...listedClass, uuid: 'other-class', companyUuid: 'other-company', companyName: 'Other Company' }],
          next: null,
        },
      };
    if (url === URLS.HOLDERS(REGISTER.token.uuid))
      return {
        data: rows[0]?.registerEntry
          ? {
              ...REGISTER,
              issuedSupply: '100',
              totalHolders: 1,
              holders: [
                {
                  member: rows[0].member,
                  name: rows[0].name,
                  holderType: 'member',
                  balance: '100',
                  percentage: 100,
                  enteredOn: '2026-10-11',
                  wallets: [],
                },
              ],
            }
          : REGISTER,
      };
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
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [], awardRecipients: [] } };
    if (url === URLS.REGISTER_LINK_WAITING_WALLETS) return { data: { wallets: [] } };
    return { data: { results: [], next: null } };
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
      return {
        data: {
          ...allotmentPreview(rows[0]),
          completeIssue: (body as RegisterAllotmentDecideRequest).completeIssue === true,
          applyAppointment:
            (body as RegisterAllotmentDecideRequest).applyAppointment ??
            (body as RegisterAllotmentDecideRequest).appointment,
          ...(incompleteImpact ? { currentHolders: undefined } : {}),
        },
      };
    if (url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid)) {
      const request = body as RegisterAllotmentDecideRequest;
      if (request.kind === 'approve' && staleApproval) {
        staleApproval = false;
        throw Object.assign(new Error('Request failed with status code 409'), {
          response: { status: 409, data: { detail: 'The ownership snapshot changed. Preview again.' } },
        });
      }
      if (!rows[0].decisions.some((decision) => decision.idempotencyKey === request.idempotencyKey))
        rows = [allotmentDecision(rows[0], request)];
      if (request.kind === 'approve' && request.completeIssue && !interruptedIssue) {
        interruptedIssue = true;
        failedRead = true;
        throw new Error('Synthetic interrupted issue response');
      }
      return { data: rows[0] };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyRegisterScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  const open = await view.findByRole('button', { name: COPY.PREPARE });
  await waitFor(() => expect(open).not.toBeDisabled());
  await fireEvent.press(open);
  expect(await view.findByLabelText('Company issue date (YYYY-MM-DD)')).toHaveDisplayValue('');
  for (const [label, value] of [
    ['Name', ALLOTMENT_REQUEST.name!],
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
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Company issue date (YYYY-MM-DD)'), '2999-01-01');
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Company issue date (YYYY-MM-DD)'), '2026-10-10');
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByRole('alert');
  expect(rows[0].registerEntry).toBeNull();
  expect(view.getByLabelText(COPY.CONSIDERATION).props.editable).toBe(false);
  expect(view.getByLabelText('Company issue date (YYYY-MM-DD)')).toHaveProp('editable', false);
  expect(view.getByLabelText('Company issue date (YYYY-MM-DD)')).toHaveDisplayValue('2026-10-10');
  expect(post.mock.calls.find(([url]) => url === URLS.REGISTER_ALLOTMENTS)?.[1]).toEqual(
    expect.objectContaining({ companyEventOn: '2026-10-10' }),
  );
  await waitFor(() => expect(view.getByRole('button', { name: 'Refresh share issues' })).not.toBeDisabled());
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
  await fireEvent.press(await view.findByRole('button', { name: /^Review and approve for external allotment/ }));
  await fireEvent.press(await view.findByRole('button', { name: 'Cancel' }));
  expect(await view.findByLabelText('Company issue date (YYYY-MM-DD)')).toHaveDisplayValue('2026-10-10');
  expect(view.getByLabelText('Company issue date (YYYY-MM-DD)')).toHaveProp('editable', false);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Close allotment form' })).toBeNull());
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(view.queryByRole('button', { name: /^(Record issue|Shares recorded) for external allotment/ })).toBeNull();
  incompleteImpact = true;
  await fireEvent.press(view.getByRole('button', { name: /^Review and approve for external allotment/ }));
  await view.findByText(COPY.OWNERSHIP_UNAVAILABLE);
  expect(view.getByRole('button', { name: 'Approve' })).toBeDisabled();
  expect(rows[0].decisions).toHaveLength(0);
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: /^Reject for external allotment/ }));
  await fireEvent.changeText(view.getByLabelText(COPY.REJECTION_REASON), 'Withdraw instruction');
  await fireEvent.press(view.getByRole('button', { name: 'Preview the rejection' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Reject allotment' })).not.toBeDisabled());
  expect(view.queryByText('Ownership impact')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  incompleteImpact = false;
  await fireEvent.press(view.getByRole('button', { name: /^Review and approve for external allotment/ }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Approve' })).not.toBeDisabled());
  await fireEvent.press(view.getByRole('button', { name: 'Approve' }));
  await view.findByText('The ownership snapshot changed. Preview again.');
  expect(rows[0].decisions).toHaveLength(0);
  expect(rows[0].registerEntry).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: /^Review and approve for external allotment/ }));
  const confirm = await view.findByRole('button', { name: 'Approve' });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  expect(view.getByRole('header', { name: 'Review share issue' })).toBeTruthy();
  expect(view.getByRole('radio', { name: REGISTER.token.name })).toBeDisabled();
  expect(view.getByText('10 October 2026')).toBeTruthy();
  expect(view.getByText('Ordinary shares (ORD)')).toBeTruthy();
  expect(view.getByText('AUD 2.5000')).toBeTruthy();
  expect(view.getByText('100 shares · 100.00%')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Record issue' })).toBeNull();
  await fireEvent.press(confirm);
  await waitFor(() => expect(rows[0].decisions).toHaveLength(2));
  await view.findByRole('button', { name: 'Recover original decision receipt' });
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await view.findByRole('button', { name: /^Recover approve receipt/ });
  const combined = () =>
    post.mock.calls
      .filter(
        ([url, body]) =>
          url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid) &&
          (body as RegisterAllotmentDecideRequest).idempotencyKey ===
            rows[0].decisions.find((decision) => decision.completeIssue)?.idempotencyKey,
      )
      .map(([, body]) => body);
  const original = combined()[0];
  expect(original).toEqual(
    expect.objectContaining({ kind: 'approve', completeIssue: true, applyAppointment: APPOINTMENT.uuid }),
  );
  const previews = post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid)).length;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
  await view.findByText(/External allotments could not be loaded/);
  expect(view.queryByRole('header', { name: ALLOTMENT_REQUEST.name })).toBeNull();
  failedPreferences = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
  });
  expect(view.queryByRole('button', { name: /^Recover approve receipt/ })).toBeNull();
  listed = false;
  await act(async () => {
    await client.refetchQueries({ queryKey: [...registerKey(getSessionEpoch()), 'classes'] });
  });
  expect(view.queryByText('Other Company')).toBeNull();
  expect(view.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  const retryRegister = await view.findByRole('button', { name: 'Retry register' });
  listed = true;
  failedRead = false;
  failedPreferences = false;
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  await fireEvent.press(retryRegister);
  const retryAllotments = await view.findByRole('button', {
    name: /^(Retry external allotments|Refresh share issues)$/,
  });
  await waitFor(() => expect(retryAllotments).not.toBeDisabled());
  await fireEvent.press(retryAllotments);
  await view.findByRole('button', { name: /^Recover approve receipt/ });
  mockSection = 'shareholders';
  await view.rerender(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyRegisterScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await view.findByText('100 · 100.00%');
  mockSection = 'awards';
  await view.rerender(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyRegisterScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  expect(view.queryByRole('button', { name: /^Recover approve receipt/ })).toBeNull();
  mockSection = 'issue';
  await view.rerender(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyRegisterScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await fireEvent.press(await view.findByRole('button', { name: /^Recover approve receipt/ }));
  await waitFor(() => expect(view.queryByRole('button', { name: /^Recover approve receipt/ })).toBeNull());
  expect(combined()).toEqual([original, original]);
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid))).toHaveLength(
    previews,
  );
  expect(rows[0].decisions).toHaveLength(2);
  expect(view.queryByRole('button', { name: /^Review and approve for external allotment/ })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: `Details and documents for ${ALLOTMENT_REQUEST.name}` }));
  expect(view.queryByText(COPY.OWNERSHIP_TITLE)).toBeNull();
  await view.findByText('entry-a');
  await fireEvent.press(view.getByRole('button', { name: /^Download receipt/ }));
  await waitFor(() => expect(releaseFile).toBeDefined());
  failedRead = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
  await view.findByText(/External allotments could not be loaded/);
  expect(view.queryByText('entry-a')).toBeNull();
  expect(view.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(view.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  await act(async () => {
    releaseFile!();
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  failedRead = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry external allotments' }));
  await view.findByText('entry-a');
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
  await waitFor(() => expect(view.queryByText('entry-a')).toBeNull());
  expect(view.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
});
