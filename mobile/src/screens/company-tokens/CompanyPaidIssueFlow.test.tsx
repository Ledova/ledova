import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosHeaders } from 'axios';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  type OwnCompanyAppointment,
  type RegisterPaidIssueSource,
  type RegisterPaidIssue,
  type RegisterPaidIssuePreparation,
  type RegisterPaidIssueDecideRequest,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope } from '../../services/sessionScope';
import { pickedFile, resetFiles, files } from '../../testSupport/documentFiles';
import { CompanyPaidIssueFlow } from './CompanyPaidIssueFlow';
import { useTokenDetail } from './useTokenDetail';

jest.mock('../../services/apiClient', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), defaults: { transformRequest: [] } },
}));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
const get = jest.mocked(apiClient.get),
  post = jest.mocked(apiClient.post);
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = ID(100),
  COMPANY = ID(101),
  DIGEST = 'd'.repeat(64);
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const appointment: OwnCompanyAppointment = {
  uuid: ID(105),
  company: COMPANY,
  companyName: 'Synthetic Company',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  source: 'invitation',
  declarationText: null,
  declarationVersion: null,
};
const token = {
  uuid: TOKEN,
  company: COMPANY,
  companyUuid: COMPANY,
  companyName: 'Synthetic Company',
  name: 'Ordinary shares',
  symbol: 'ORD',
  status: 'deployed',
  statusDisplay: 'Deployed',
  tokenTypeDisplay: 'Ordinary',
  totalSupply: '1000',
  decimals: 0,
  isTransferable: true,
  isDivisible: false,
  isOwner: false,
  chain: 'base',
  contractAddress: `0x${'2'.repeat(40)}`,
};
const paidSource: RegisterPaidIssueSource = {
  subscription: ID(110),
  offering: ID(111),
  company: COMPANY,
  token: TOKEN,
  recipientAddress: `0x${'7'.repeat(40)}`,
  recipientName: 'Synthetic Investor',
  shares: '7',
  requestedShares: '10',
  currency: 'aud',
  pricePerShare: '2.00',
  amountDue: '20.00',
  amountReceived: '15.00',
  moneyHeld: '15.00',
  paymentReceivedOn: '2026-10-01',
  paymentReferenceSeen: 'PAY-1',
  paymentTxHash: null,
  paymentConfirmedAt: '2026-10-01T00:00:00Z',
  refundAmount: '1.00',
  refundedAt: null,
};

const page = (results: unknown[]) => ({ data: { results, count: results.length, next: null, previous: null } });
let client: QueryClient;
let classRecord: typeof token;
let appointments: OwnCompanyAppointment[];
let records: RegisterPaidIssue[];
let sources: RegisterPaidIssueSource[];
let failSources: boolean;
let delayEvidence: boolean, replyEvidence: (() => void) | null;
let failClass: boolean, failHistory: boolean, loseApply: boolean;
let sequence: number;
let prepareAnswer: jest.Mock, fileAnswer: jest.Mock;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}
function paidFrom(body: RegisterPaidIssuePreparation): RegisterPaidIssue {
  const captured = sources.find((row) => row.subscription === body.subscription) ?? paidSource;
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: captured.token,
    subscription: body.subscription,
    request: null,
    shares: captured.shares,
    subscriptionStatus: 'paid',
    allottedAt: null,
    approvingDirector: body.approvingDirector,
    reason: body.reason ?? '',
    authorityReference: body.authorityReference,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    snapshot: {
      company: { uuid: COMPANY, name: 'Synthetic Company', acn: '123456789', status: 'active' },
      token: {
        uuid: captured.token,
        name: token.name,
        symbol: token.symbol,
        chain: 'base',
        contractAddress: token.contractAddress,
        authorisedShares: '1000',
      },
      source: structuredClone(captured),
      register: { present: true, uuid: ID(115), sequence: 3, headHash: DIGEST, issuedSupply: '10' },
      transaction: {
        chainId: 84532,
        sender: `0x${'6'.repeat(40)}`,
        to: token.contractAddress,
        value: '0',
        data: '0x1234',
      },
    },
    intentDigest: DIGEST,
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    approvalDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-01T00:00:00Z',
    execution: null,
    executionUnmetRequirements: [],
  };
}
function prepared() {
  return paidFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    subscription: paidSource.subscription,
    approvingDirector: 'Synthetic Director',
    reason: 'Approve recorded paid allotment',
    authorityReference: 'BOARD-1',
    authorityEvidence: ID(121),
  });
}
function executeGuards(config: Parameters<typeof apiClient.post>[2], body: unknown) {
  config?.ledovaSubmissionGuard?.();
  const transformers = config?.transformRequest;
  const context = { ...config, headers: new AxiosHeaders() };
  for (const transform of Array.isArray(transformers) ? transformers : transformers ? [transformers] : [])
    transform.call(context, body, context.headers);
}
function Subject({ uuid = TOKEN }: { uuid?: string }) {
  const data = useTokenDetail(uuid);
  return <CompanyPaidIssueFlow uuid={uuid} data={data} />;
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
async function open() {
  const view = await render(<Subject />, { wrapper });
  await view.findByRole('button', { name: 'Prepare paid issue' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return view;
}
async function fill(view: Awaited<ReturnType<typeof open>>) {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${paidSource.subscription} ·`) }));
  await fireEvent.changeText(view.getByLabelText('Approving director'), ' Synthetic Director ');
  await fireEvent.changeText(view.getByLabelText('Paid issue reason'), ' Approve recorded paid allotment ');
  await fireEvent.changeText(view.getByLabelText('Authority reference'), ' BOARD-1 ');
  await fireEvent.press(view.getByRole('button', { name: 'Choose the paid issue authority document' }));
  await view.findByRole('button', { name: 'Replace the paid issue authority document' });
}
async function decide(view: Awaited<ReturnType<typeof open>>, kind: 'Approve' | 'Apply' | 'Reject', reason?: string) {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${kind} the company paid issue`) }));
  if (reason) {
    await fireEvent.changeText(view.getByLabelText('Reason for rejection'), reason);
    await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
  }
  const confirm = await view.findByRole('button', { name: 'Confirm' });
  await waitFor(() => expect(confirm.props.accessibilityState?.disabled).toBe(false));
  await fireEvent.press(confirm);
}
beforeEach(() => {
  resetFiles();
  classRecord = { ...token };
  appointments = [{ ...appointment, expiresAt: null }];
  records = [];
  sources = [structuredClone(paidSource)];
  failSources = false;
  delayEvidence = false;
  replyEvidence = null;
  failClass = false;
  failHistory = false;
  loseApply = false;
  sequence = 200;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => ID(++sequence) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockReset()
    .mockImplementation(async () => pickedFile(++picks));
  jest.mocked(Sharing.shareAsync).mockClear();
  append = jest.spyOn(FormData.prototype, 'append');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  fileAnswer = jest.fn(async () => ({
    data: Uint8Array.from([1, 2]).buffer,
    headers: { 'content-type': 'application/pdf' },
  }));
  get.mockReset().mockImplementation(async (url, config) => {
    config?.ledovaSubmissionGuard?.();
    if (url === APPOINTMENTS) return page(appointments);
    if (url === URLS.DETAIL(TOKEN)) {
      if (failClass) throw new Error('Unavailable class');
      return { data: classRecord };
    }
    if (url === URLS.HOLDERS(TOKEN))
      return {
        data: {
          token: classRecord,
          initialized: true,
          issuedSupply: '10',
          waitingEffects: 0,
          totalHolders: 0,
          holders: [],
          formerMembers: [],
        },
      };
    if (url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS) {
      if (failSources) throw new Error('Unavailable paid source');
      return { data: structuredClone(sources) };
    }
    if (url === URLS.REGISTER_PAID_ISSUES) {
      if (failHistory) throw new Error('Unavailable pause history');
      return page(records.map((row) => structuredClone(row)));
    }
    if (url.endsWith('/file/')) return fileAnswer();
    throw new Error(`Unexpected private GET ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterPaidIssuePreparation) => {
    const record = records.find((row) => row.uuid === body.operationId) ?? paidFrom(body);
    if (!records.some((row) => row.uuid === record.uuid)) records.push(record);
    return { data: structuredClone(record) };
  });
  post.mockReset().mockImplementation(async (url, body, config) => {
    executeGuards(config, body);
    if (url === URLS.REGISTER_EVIDENCE) {
      if (delayEvidence)
        await new Promise<void>((resolve) => {
          replyEvidence = resolve;
        });
      return {
        data: {
          uuid: ID(300 + post.mock.calls.length),
          company: field(body, 'company_id'),
          appointment: field(body, 'appointment'),
          kind: field(body, 'kind'),
          idempotencyKey: field(body, 'idempotency_key'),
          originalFilename: (field(body, 'file') as unknown as { name: string }).name,
          fileSize: 5,
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-10-01T00:00:00Z',
        },
      };
    }
    if (url === URLS.REGISTER_PAID_ISSUES) return prepareAnswer(body);
    const record = records.find(
      (row) => url === URLS.REGISTER_PAID_ISSUE_PREVIEW(row.uuid) || url === URLS.REGISTER_PAID_ISSUE_DECIDE(row.uuid),
    );
    if (record) {
      const decisionBody = body as RegisterPaidIssueDecideRequest;
      if (url === URLS.REGISTER_PAID_ISSUE_PREVIEW(record.uuid))
        return {
          data: {
            previewDigest: DIGEST,
            unmetRequirements: [],
            canDecide: true,
            snapshot: record.snapshot,
            intentDigest: record.intentDigest,
            approvalDecision:
              decisionBody.kind === 'apply'
                ? (record.decisions.find((row) => row.kind === 'approve')?.uuid ?? null)
                : null,
            shares: record.shares,
            approvingDirector: record.approvingDirector,
            offeringHeadroom: '100',
            issuedSupply: '10',
            reservedShares: '0',
            authorisedSupply: '1000',
            availableShares: '990',
            reason: record.reason,
            authorityReference: record.authorityReference,
          },
        };
      if (!record.decisions.some((row) => row.idempotencyKey === decisionBody.idempotencyKey)) {
        const decision = {
          uuid: ID(3000 + ++sequence),
          appointment: decisionBody.appointment,
          kind: decisionBody.kind,
          reason: decisionBody.reason ?? '',
          digest: decisionBody.previewDigest,
          idempotencyKey: decisionBody.idempotencyKey,
          decidedAt: '2026-10-08T00:00:00Z',
          decidedBy: 1,
          decidedByName: 'Synthetic Appointee',
        };
        record.decisions.push(decision);
        record.stage =
          decisionBody.kind === 'approve' ? 'approved' : decisionBody.kind === 'apply' ? 'applied' : 'rejected';
        if (decisionBody.kind !== 'approve') {
          record.status = decisionBody.kind === 'apply' ? 'applied' : 'rejected';
          record.reviewedAt = decision.decidedAt;
        }
        if (decisionBody.kind === 'apply') {
          record.approvalDecision = record.decisions.find((row) => row.kind === 'approve')!.uuid;
          record.request = ID(140);
          record.execution = {
            execution: ID(141),
            request: record.request,
            dispatchId: ID(142),
            status: 'queued',
            issuance: null,
            operationId: null,
            claimId: null,
            operationStatus: null,
            transaction: null,
            txHash: null,
            blockNumber: null,
            blockHash: null,
            completedAt: null,
            registerEntry: null,
            effectiveOn: null,
          };
        }
        if (decisionBody.kind === 'reject') record.rejectionReason = decisionBody.reason ?? '';
      }
      if (loseApply && decisionBody.kind === 'apply') {
        loseApply = false;
        throw { response: { status: 503 } };
      }
      return { data: structuredClone(record) };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
});
afterEach(async () => {
  await waitFor(() => {
    expect(client.isFetching()).toBe(0);
    expect(client.isMutating()).toBe(0);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('prepares and approves a partial recorded paid allotment without admission, then binds its original queued execution', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByText('Prepared paid issue');
  expect(prepareAnswer).toHaveBeenCalledWith({
    operationId: expect.any(String),
    appointment: appointment.uuid,
    subscription: paidSource.subscription,
    approvingDirector: 'Synthetic Director',
    reason: 'Approve recorded paid allotment',
    authorityReference: 'BOARD-1',
    authorityEvidence: expect.any(String),
  });
  expect(records[0].request).toBeNull();
  expect(records[0].snapshot.source.shares).toBe('7');
  await decide(view, 'Approve');
  await view.findByText('Approved paid issue');
  expect(records[0].request).toBeNull();
  expect(records[0].execution).toBeNull();
  await decide(view, 'Apply');
  await view.findByText('Original paid issue admitted; execution queued');
  expect(records[0].execution?.request).toBe(records[0].request);
  expect(records[0].allottedAt).toBeNull();
  expect(
    [...get.mock.calls, ...post.mock.calls].every(
      ([url]) => !/wallet|nomination|eligibility|register-links|register-members|subscriptions\/.*allot/.test(url),
    ),
  ).toBe(true);
});
it('loads no selector or POST for a read-only register appointee while sharing the private authority copy', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  const view = await render(<Subject />, { wrapper });
  await view.findByText('Prepared paid issue');
  expect(view.queryByRole('button', { name: 'Prepare paid issue' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: /^Download authority document of company paid issue/ }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(post).not.toHaveBeenCalled();
  expect(get.mock.calls.some(([url]) => url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS)).toBe(false);
});
it('uses narrow approve/apply without preparer source selection and rejects only the proposal', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  const view = await render(<Subject />, { wrapper });
  await view.findByText('Prepared paid issue');
  await decide(view, 'Approve');
  await view.findByText('Approved paid issue');
  appointments = [{ ...appointment, capabilities: ['apply'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByRole('button', { name: /^Apply the company paid issue/ });
  await decide(view, 'Apply');
  await view.findByText('Original paid issue admitted; execution queued');
  expect(get.mock.calls.some(([url]) => url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS)).toBe(false);
  records.push({ ...prepared(), uuid: ID(123), operationId: ID(123) });
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('Prepared paid issue');
  await decide(view, 'Reject', 'Company refuses proposal');
  await view.findByText('Rejected paid issue');
  expect(records[1].request).toBeNull();
  expect(records[1].subscriptionStatus).toBe('paid');
  expect(records[1].execution).toBeNull();
});
it('blocks evidence after failed source refresh and preserves a draft for the healthy exact retry', async () => {
  const view = await open();
  await fill(view);
  failSources = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText(/Available paid subscription sources could not be refreshed/);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByText('Refresh the exact available paid subscription sources before continuing.');
  expect(post).not.toHaveBeenCalled();
  expect(view.getByLabelText('Paid issue reason').props.value).toBe(' Approve recorded paid allotment ');
  failSources = false;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByText('Prepared paid issue');
  expect(post.mock.calls.map(([url]) => url)).toEqual([URLS.REGISTER_EVIDENCE, URLS.REGISTER_PAID_ISSUES]);
});
it('checks the captured source again after awaited upload and requires explicit recapture before preparing changed payment facts', async () => {
  const view = await open();
  await fill(view);
  delayEvidence = true;
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await waitFor(() => expect(replyEvidence).not.toBeNull());
  sources[0].amountReceived = '17.00';
  sources[0].moneyHeld = '17.00';
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-paid-issue-sources'] });
    replyEvidence!();
  });
  await view.findByText('The captured paid subscription source changed. Select its current recorded terms.');
  expect(prepareAnswer).not.toHaveBeenCalled();
  delayEvidence = false;
  await fireEvent.press(view.getByRole('button', { name: 'Use current recorded source' }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose the paid issue authority document' }));
  await view.findByRole('button', { name: 'Replace the paid issue authority document' });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByText('Prepared paid issue');
  expect(records[0].snapshot.source.amountReceived).toBe('17.00');
});
it('retains original preparation body/key after ambiguity and recovers by current private read after source loss', async () => {
  const healthy = prepareAnswer.getMockImplementation()!;
  prepareAnswer.mockImplementationOnce(async (body: RegisterPaidIssuePreparation) => {
    await healthy(body);
    throw { response: { status: 404 } };
  });
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByRole('button', { name: 'Recover original paid issue preparation receipt' });
  const original = post.mock.calls.find(([url]) => url === URLS.REGISTER_PAID_ISSUES)![1];
  failClass = true;
  failHistory = true;
  failSources = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-paid-issue-appointments'] });
    await client.refetchQueries({ queryKey: ['company-paid-issues'] });
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
  });
  await fireEvent.press(view.getByRole('button', { name: 'Recover original paid issue preparation receipt' }));
  await waitFor(() =>
    expect(view.queryByRole('button', { name: 'Recover original paid issue preparation receipt' })).toBeNull(),
  );
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_PAID_ISSUES).map(([, body]) => body)).toEqual([
    original,
    original,
  ]);
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
});
it('recovers exact consumed APPLY after class/history loss without another admission', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByText('Prepared paid issue');
  await decide(view, 'Approve');
  await view.findByText('Approved paid issue');
  loseApply = true;
  await decide(view, 'Apply');
  await view.findByRole('button', { name: /^Recover apply receipt/ });
  const original = post.mock.calls.find(
    ([url, body]) =>
      url === URLS.REGISTER_PAID_ISSUE_DECIDE(records[0].uuid) &&
      (body as RegisterPaidIssueDecideRequest).kind === 'apply',
  )!;
  failClass = true;
  failHistory = true;
  failSources = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-paid-issue-appointments'] });
    await client.refetchQueries({ queryKey: ['company-paid-issues'] });
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
  });
  await fireEvent.press(view.getByRole('button', { name: /^Recover apply receipt/ }));
  await view.findByText('Original paid issue admitted; execution queued');
  expect(
    post.mock.calls
      .filter(([url, body]) => url === original[0] && (body as RegisterPaidIssueDecideRequest).kind === 'apply')
      .map(([, body]) => body),
  ).toEqual([original[1], original[1]]);
  expect(records[0].decisions.filter((row) => row.kind === 'apply')).toHaveLength(1);
});
it('preserves genuine latest Mint/register receipts without inferring from recorded allotment or changed supply', async () => {
  records = [prepared()];
  const view = await open();
  await decide(view, 'Approve');
  await view.findByText('Approved paid issue');
  await decide(view, 'Apply');
  await view.findByText('Original paid issue admitted; execution queued');
  records[0].subscriptionStatus = 'allotted';
  records[0].allottedAt = '2026-10-08T00:01:00Z';
  classRecord.totalSupply = '1007';
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('allotted');
  expect(view.queryByText(/Finalised original paid mint/)).toBeNull();
  records[0].execution = {
    ...records[0].execution!,
    status: 'executed',
    issuance: ID(150),
    operationId: ID(151),
    claimId: ID(152),
    transaction: ID(153),
    operationStatus: 'confirmed',
    txHash: `0x${'3'.repeat(64)}`,
    blockNumber: 7,
    blockHash: `0x${'4'.repeat(64)}`,
    completedAt: '2026-10-08T00:02:00Z',
  };
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('Finalised original paid mint; register entry not recorded');
  records[0].execution!.registerEntry = ID(154);
  records[0].execution!.effectiveOn = '2026-10-08';
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('Finalised original paid mint recorded in the register');
  records[0].execution!.operationId = [] as unknown as string;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('Original marked executed; complete original mint receipt unavailable');
  expect(view.queryByText(/Finalised original paid mint/)).toBeNull();
  records[0].execution!.operationId = ID(151);
  records[0].execution!.registerEntry = [ID(154)] as unknown as string;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('Finalised original paid mint; register entry not recorded');
  expect(view.queryByText('Finalised original paid mint recorded in the register')).toBeNull();
  records[0].execution!.registerEntry = ID(154);
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('Finalised original paid mint recorded in the register');
  failHistory = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await view.findByText('The paid issue records could not be refreshed. Retained original receipts remain available.');
  expect(view.getByText('Finalised original paid mint recorded in the register')).toBeTruthy();
});
it('saves and shares no delayed private paid authority bytes after native session epoch changes', async () => {
  records = [prepared()];
  const view = await open();
  let reply: (() => void) | null = null;
  fileAnswer.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      reply = resolve;
    });
    return { data: Uint8Array.from([1, 2]).buffer, headers: { 'content-type': 'application/pdf' } };
  });
  await fireEvent.press(view.getByRole('button', { name: /^Download authority document of company paid issue/ }));
  await waitFor(() => expect(reply).not.toBeNull());
  await act(async () => {
    invalidateSessionScope();
    reply!();
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect([...files.keys()].some((path) => path.includes('paid-issue-authority'))).toBe(false);
});
it('blocks invalid terms and expired personal authority before fresh evidence', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.changeText(view.getByLabelText('Approving director'), 'x'.repeat(256));
  expect(view.getByRole('button', { name: 'Prepare paid issue' }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getByLabelText('Approving director'), 'Synthetic Director');
  const now = Date.now();
  appointments[0].expiresAt = new Date(now + 1000).toISOString();
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company paid issue records' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  jest.spyOn(Date, 'now').mockReturnValue(now + 2000);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  expect(post).not.toHaveBeenCalled();
});
it('retains a mismatched preparation receipt for exact original retry, and blocks all sends after actual account change', async () => {
  const healthy = prepareAnswer.getMockImplementation()!;
  prepareAnswer.mockImplementationOnce(async (body: RegisterPaidIssuePreparation) => {
    const answer = await healthy(body);
    return { data: { ...answer.data, approvingDirector: 'Other Director' } };
  });
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByRole('button', { name: 'Recover original paid issue preparation receipt' });
  const original = post.mock.calls.find(([url]) => url === URLS.REGISTER_PAID_ISSUES)![1];
  await fireEvent.press(view.getByRole('button', { name: 'Recover original paid issue preparation receipt' }));
  await view.findByText('Prepared paid issue');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_PAID_ISSUES).map(([, body]) => body)).toEqual([
    original,
    original,
  ]);
  const sent = post.mock.calls[0][2];
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-user', userAccount: { uuid: 'other-account', role: 'investor' } },
    });
  });
  expect(() => sent!.ledovaSubmissionGuard!()).toThrow('account or selected class changed');
  expect(view.queryByText('Prepared paid issue')).toBeNull();
});

it('does not expose prior-class retained original recovery when the same component changes class in its company', async () => {
  const healthy = prepareAnswer.getMockImplementation()!;
  prepareAnswer.mockImplementationOnce(async (body: RegisterPaidIssuePreparation) => {
    await healthy(body);
    throw { response: { status: 503 } };
  });
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare paid issue' }));
  await view.findByRole('button', { name: 'Recover original paid issue preparation receipt' });
  const original = records[0],
    other = ID(999);
  const previous = get.getMockImplementation()!;
  get.mockImplementation(async (url, config) => {
    config?.ledovaSubmissionGuard?.();
    if (url === URLS.DETAIL(other))
      return { data: { ...classRecord, uuid: other, contractAddress: `0x${'9'.repeat(40)}` } };
    if (url === URLS.HOLDERS(other))
      return {
        data: {
          token: { ...classRecord, uuid: other },
          initialized: true,
          holders: [],
          issuedSupply: '0',
          waitingEffects: 0,
          totalHolders: 0,
          formerMembers: [],
        },
      };
    if ((config?.params as { token?: unknown } | undefined)?.token === other) {
      if (url === URLS.REGISTER_PAID_ISSUES) return page([]);
      if (url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS) return { data: [] };
    }
    return previous(url, config);
  });
  await view.rerender(<Subject uuid={other} />);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(view.queryByRole('button', { name: 'Recover original paid issue preparation receipt' })).toBeNull();
  expect(view.queryByText(original.uuid)).toBeNull();
  expect(view.queryByText('Prepared paid issue')).toBeNull();
  expect(prepareAnswer).toHaveBeenCalledTimes(1);
});
