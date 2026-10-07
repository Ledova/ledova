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
  type RegisterCapitalIncrease,
  type RegisterCapitalIncreasePreparation,
  type RegisterCapitalIncreaseDecideRequest,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope } from '../../services/sessionScope';
import { pickedFile, resetFiles, files, nativeFileSystem } from '../../testSupport/documentFiles';
import { CompanyCapitalFlow } from './CompanyCapitalFlow';
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
const page = (results: unknown[]) => ({ data: { results, count: results.length, next: null, previous: null } });
let client: QueryClient;
let classRecord: typeof token;
let appointments: OwnCompanyAppointment[];
let records: RegisterCapitalIncrease[];
let failClass: boolean, failHistory: boolean, loseApply: boolean;
let sequence: number;
let prepareAnswer: jest.Mock, fileAnswer: jest.Mock;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}
function capitalFrom(body: RegisterCapitalIncreasePreparation): RegisterCapitalIncrease {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: body.token,
    request: ID(150),
    additionalShares: String(body.additionalShares),
    newAuthorizedTotal: String(body.newAuthorizedTotal),
    purpose: body.purpose,
    boardResolutionReference: body.boardResolutionReference,
    shareholderApprovalReference: body.shareholderApprovalReference ?? '',
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    snapshot: {
      company: { uuid: COMPANY, name: 'Synthetic Company', acn: '123456789', status: 'active' },
      token: {
        uuid: TOKEN,
        name: token.name,
        symbol: token.symbol,
        chain: 'base',
        contractAddress: token.contractAddress,
        authorisedShares: '1000',
        decimals: 0,
      },
      capital: {
        priorAuthorizedTotal: '1000',
        additionalShares: String(body.additionalShares),
        newAuthorizedTotal: String(body.newAuthorizedTotal),
        purpose: body.purpose,
        boardResolutionReference: body.boardResolutionReference,
        shareholderApprovalReference: body.shareholderApprovalReference ?? '',
      },
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
  return capitalFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    token: TOKEN,
    additionalShares: 25,
    newAuthorizedTotal: 1025,
    purpose: 'Support future share issues',
    boardResolutionReference: 'BOARD-1',
    shareholderApprovalReference: '',
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
function Subject() {
  const data = useTokenDetail(TOKEN);
  return <CompanyCapitalFlow uuid={TOKEN} data={data} />;
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
  await view.findByRole('button', { name: 'Prepare capital increase' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return view;
}
async function fill(view: Awaited<ReturnType<typeof open>>, additional = '25') {
  for (const [label, value] of [
    ['Additional authorised shares', additional],
    ['Purpose', ' Support future share issues '],
    ['Board resolution reference', ' BOARD-1 '],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  if (/^\d+$/.test(additional) && BigInt(additional) > 0n && BigInt(additional) + 1000n <= 2147483647n) {
    await fireEvent.press(view.getByRole('button', { name: 'Choose the capital authority document' }));
    await view.findByRole('button', { name: 'Replace the capital authority document' });
  }
}
async function decide(view: Awaited<ReturnType<typeof open>>, kind: 'Approve' | 'Apply' | 'Reject', reason?: string) {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${kind} the company capital increase`) }));
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
    if (url === URLS.REGISTER_CAPITAL_INCREASES) {
      if (failHistory) throw new Error('Unavailable capital history');
      return page(records.map((row) => structuredClone(row)));
    }
    if (url.endsWith('/file/')) return fileAnswer();
    throw new Error(`Unexpected private GET ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterCapitalIncreasePreparation) => {
    const record = records.find((row) => row.uuid === body.operationId) ?? capitalFrom(body);
    if (!records.some((row) => row.uuid === record.uuid)) records.push(record);
    return { data: structuredClone(record) };
  });
  post.mockReset().mockImplementation(async (url, body, config) => {
    executeGuards(config, body);
    if (url === URLS.REGISTER_EVIDENCE)
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
    if (url === URLS.REGISTER_CAPITAL_INCREASES) return prepareAnswer(body);
    const record = records.find(
      (row) =>
        url === URLS.REGISTER_CAPITAL_INCREASE_PREVIEW(row.uuid) ||
        url === URLS.REGISTER_CAPITAL_INCREASE_DECIDE(row.uuid),
    );
    if (record) {
      const decisionBody = body as RegisterCapitalIncreaseDecideRequest;
      if (url === URLS.REGISTER_CAPITAL_INCREASE_PREVIEW(record.uuid))
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
            ...record.snapshot.capital,
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
          record.execution = {
            execution: ID(151),
            request: record.request!,
            dispatchId: ID(152),
            status: 'executing',
            operationId: null,
            claimId: null,
            operationStatus: null,
            transaction: null,
            txHash: null,
            blockNumber: null,
            blockHash: null,
            gasUsed: null,
            projectedAt: null,
            attributionRequired: false,
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

it.each(['deployed', 'paused'])(
  'lets a nonowner ADMIN prepare, approve and apply a zero-mint cap increase on a %s Base class',
  async (status) => {
    classRecord.status = status;
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
    await view.findByText('Prepared capital increase');
    expect(prepareAnswer).toHaveBeenCalledWith({
      operationId: expect.any(String),
      appointment: appointment.uuid,
      token: TOKEN,
      additionalShares: 25,
      newAuthorizedTotal: 1025,
      purpose: 'Support future share issues',
      boardResolutionReference: 'BOARD-1',
      shareholderApprovalReference: '',
      authorityEvidence: expect.any(String),
    });
    await decide(view, 'Approve');
    await view.findByText('Approved capital increase');
    expect(records[0]!.execution).toBeNull();
    await decide(view, 'Apply');
    await view.findByText('Original capital increase admitted; execution queued');
    expect(classRecord.totalSupply).toBe('1000');
    expect(records[0]!.execution?.status).toBe('executing');
    expect(
      [...get.mock.calls, ...post.mock.calls].every(
        ([url]) => !/wallet|nomination|eligibility|issuance|register-links|register-members/.test(url),
      ),
    ).toBe(true);
    expect(view.queryByText('Finalised original cap increase projected')).toBeNull();
  },
);
it('lets a read-register-only appointee read private authority copies and history without fresh POST', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  const view = await render(<Subject />, { wrapper });
  await view.findByText('Prepared capital increase');
  expect(view.queryByRole('button', { name: 'Prepare capital increase' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: /^Download authority document of company capital increase/ }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(post).not.toHaveBeenCalled();
});
it.each(['0', '-1', '1.5', '1e2', '+1', '2147483647', '2147483648'])(
  'refuses unsupported delta/target %s before native file acquisition or evidence POST',
  async (value) => {
    const view = await open();
    await fill(view, value);
    expect(view.getByRole('button', { name: 'Prepare capital increase' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
    expect(post).not.toHaveBeenCalled();
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  },
);
it('uses exact BigInt arithmetic at the supported cap boundary and guards a nonblank purpose and 255-character references', async () => {
  const view = await open();
  await fill(view, '2147482647');
  expect(view.getByText('New authorised cap: 2,147,483,647')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Prepare capital increase' }).props.accessibilityState.disabled).toBe(false);
  await fireEvent.changeText(view.getByLabelText('Shareholder approval reference (optional)'), 'x'.repeat(256));
  expect(view.getByRole('button', { name: 'Prepare capital increase' }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(view.getByLabelText('Shareholder approval reference (optional)'), '');
  await fireEvent.changeText(view.getByLabelText('Purpose'), ' ');
  expect(view.getByRole('button', { name: 'Prepare capital increase' }).props.accessibilityState.disabled).toBe(true);
  expect(post).not.toHaveBeenCalled();
});
it.each([403, 404, 503])(
  'keeps original full-body preparation through %s ambiguity and recovers under current read after class/history loss',
  async (status) => {
    prepareAnswer.mockImplementationOnce(async (body: RegisterCapitalIncreasePreparation) => {
      records = [capitalFrom(body)];
      throw { response: { status } };
    });
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
    await view.findByRole('button', { name: 'Recover original capital preparation receipt' });
    const original = prepareAnswer.mock.calls[0]![0];
    failClass = true;
    failHistory = true;
    appointments = [{ ...appointment, capabilities: ['read_register'] }];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
    });
    await fireEvent.press(view.getByRole('button', { name: 'Refresh company capital records' }));
    await view.findByText('The capital records could not be refreshed. Retained original receipts remain available.');
    await fireEvent.press(view.getByRole('button', { name: 'Recover original capital preparation receipt' }));
    await waitFor(() =>
      expect(view.queryByRole('button', { name: 'Recover original capital preparation receipt' })).toBeNull(),
    );
    expect(prepareAnswer.mock.calls.map(([body]) => body)).toEqual([original, original]);
    expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
  },
);
it.each([400, 409])('resolves definitive refusal %s without a false original recovery receipt', async (status) => {
  prepareAnswer.mockRejectedValueOnce({ response: { status } });
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  await waitFor(() => expect(prepareAnswer).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(view.getByRole('button', { name: 'Prepare capital increase' }).props.accessibilityState.disabled).toBe(
      false,
    ),
  );
  expect(view.queryByRole('button', { name: 'Recover original capital preparation receipt' })).toBeNull();
});
it('keeps a populated draft but sends zero fresh authority after exact source read loss, then permits the healthy same-source retry', async () => {
  const view = await open();
  await fill(view);
  failHistory = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company capital records' }));
  await view.findByText('The capital records could not be refreshed. Retained original receipts remain available.');
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  await view.findByText('Refresh the exact company capital source before continuing.');
  expect(post).not.toHaveBeenCalled();
  expect(view.getByLabelText('Purpose').props.value).toBe(' Support future share issues ');
  failHistory = false;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company capital records' }));
  await waitFor(() =>
    expect(
      view.queryByText('The capital records could not be refreshed. Retained original receipts remain available.'),
    ).toBeNull(),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  await view.findByText('Prepared capital increase');
  expect(post.mock.calls.map(([url]) => url)).toEqual([URLS.REGISTER_EVIDENCE, URLS.REGISTER_CAPITAL_INCREASES]);
});
it.each(['account', 'profile', 'epoch'] as const)(
  'refuses captured native upload/preparation transport after actual %s change',
  async (kind) => {
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
    await view.findByText('Prepared capital increase');
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Prepare capital increase' }).props.accessibilityState.disabled).toBe(
        false,
      ),
    );
    const sent = post.mock.calls.filter(
      ([url]) => url === URLS.REGISTER_EVIDENCE || url === URLS.REGISTER_CAPITAL_INCREASES,
    );
    await act(async () => {
      if (kind === 'epoch') invalidateSessionScope();
      else
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: {
            userProfile: kind === 'profile' ? 'other-user' : 'native-user',
            userAccount: { uuid: kind === 'account' ? 'other-account' : 'native-account', role: 'investor' },
          },
        });
    });
    for (const [, , config] of sent) expect(() => config!.ledovaSubmissionGuard!()).toThrow();
  },
);
it('rechecks the captured cap after real native file acquisition before any authority upload', async () => {
  const view = await open();
  await fireEvent.changeText(view.getByLabelText('Additional authorised shares'), '25');
  await fireEvent.changeText(view.getByLabelText('Purpose'), 'Support future share issues');
  await fireEvent.changeText(view.getByLabelText('Board resolution reference'), 'BOARD-1');
  let finish!: (value: Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>) => void;
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Choose the capital authority document' }));
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    classRecord.totalSupply = '1001';
    await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
    finish(pickedFile(1));
  });
  await view.findByText(
    'The captured authorised cap or exact increase changed. Refresh before a new capital decision.',
  );
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  expect(post).not.toHaveBeenCalled();
});
it('keeps the admitted original apply decision through later stage/read loss and recovers one identical request', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  await view.findByText('Prepared capital increase');
  await decide(view, 'Approve');
  await view.findByText('Approved capital increase');
  loseApply = true;
  await decide(view, 'Apply');
  await view.findByRole('button', { name: /^Recover apply receipt for company capital increase/ });
  const original = post.mock.calls.find(
    ([url, body]) =>
      url === URLS.REGISTER_CAPITAL_INCREASE_DECIDE(records[0]!.uuid) &&
      (body as RegisterCapitalIncreaseDecideRequest).kind === 'apply',
  )!;
  failClass = true;
  failHistory = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-capital-appointments'] });
    await client.refetchQueries({ queryKey: ['company-capital-increases'] });
    await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
  });
  await fireEvent.press(view.getByRole('button', { name: /^Recover apply receipt for company capital increase/ }));
  await waitFor(() =>
    expect(view.queryByRole('button', { name: /^Recover apply receipt for company capital increase/ })).toBeNull(),
  );
  expect(
    post.mock.calls
      .filter(([url, body]) => url === original[0] && (body as RegisterCapitalIncreaseDecideRequest).kind === 'apply')
      .map(([, body]) => body),
  ).toEqual([original[1], original[1]]);
  expect(records[0]!.decisions.filter((row) => row.kind === 'apply')).toHaveLength(1);
});
it('does not share or save a delayed private authority after current native session access changes', async () => {
  records = [prepared()];
  const view = await open();
  let reply: ((value: unknown) => void) | undefined;
  fileAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: /^Download authority document of company capital increase/ }));
  await waitFor(() => expect(reply).toBeDefined());
  await act(async () => {
    invalidateSessionScope();
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    reply!({ data: Uint8Array.from([1, 2]).buffer, headers: { 'content-type': 'application/pdf' } });
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect([...files.keys()].some((uri) => uri.includes('capital-authority'))).toBe(false);
  expect(nativeFileSystem.File).toBeDefined();
});
it('exposes only narrow personal company steps and retains a real rejection without an execution', async () => {
  appointments = [{ ...appointment, capabilities: ['prepare'] }];
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  await view.findByText('Prepared capital increase');
  expect(view.queryByRole('button', { name: /^Approve the company capital increase/ })).toBeNull();
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company capital records' }));
  await view.findByRole('button', { name: /^Approve the company capital increase/ });
  expect(view.queryByRole('button', { name: /^Apply the company capital increase/ })).toBeNull();
  await decide(view, 'Reject', 'Documented company refusal');
  await view.findByText('Rejected capital increase');
  expect(records[0]!.rejectionReason).toBe('Documented company refusal');
  expect(records[0]!.execution).toBeNull();
});
it('refuses every fresh authority POST when the actual personal appointment expires between refresh ticks, then accepts healthy restoration', async () => {
  const view = await open();
  await fill(view);
  appointments[0]!.expiresAt = '2000-01-01T00:00:00Z';
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  expect(post).not.toHaveBeenCalled();
  appointments[0]!.expiresAt = null;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company capital records' }));
  await view.findByRole('button', { name: 'Prepare capital increase' });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare capital increase' }));
  await view.findByText('Prepared capital increase');
});
it('rejects a foreign capital record as a current source and sends no fresh authority or capital POST', async () => {
  records = [{ ...prepared(), company: ID(999) }];
  const view = await open();
  await fireEvent.changeText(view.getByLabelText('Additional authorised shares'), '25');
  await view.findByText('The capital records could not be refreshed. Retained original receipts remain available.');
  await fireEvent.press(view.getByRole('button', { name: 'Choose the capital authority document' }));
  await view.findByText('Refresh the exact company capital source before continuing.');
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(view.queryByText('Prepared capital increase')).toBeNull();
});
