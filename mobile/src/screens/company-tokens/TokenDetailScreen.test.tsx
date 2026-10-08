import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_COPY,
  REGISTER_DEPLOYMENT_COPY as COPY,
  type RegisterDeployment,
  type RegisterDeploymentPreparation,
  type RegisterDeploymentDecideRequest,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { invalidateSessionScope } from '../../services/sessionScope';
import { TokenDetailScreen } from './TokenDetailScreen';

let mockCompanyRole = 'company';
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { role: mockCompanyRole }, isLoading: false, isError: false }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const uuid = 'ordinary';
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const DIGEST = 'd'.repeat(64);
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const token = {
  uuid,
  companyUuid: 'company',
  companyName: 'Paper Company',
  name: 'Ordinary shares',
  symbol: 'ORD',
  status: 'deployed',
  statusDisplay: 'Deployed',
  tokenTypeDisplay: 'Ordinary',
  totalSupply: '1000',
  decimals: 0,
  isTransferable: true,
  isDivisible: false,
  isOwner: true,
};
const register = {
  token,
  initialized: true,
  issuedSupply: '9007199254740993',
  waitingEffects: 2,
  totalHolders: 0,
  holders: [],
};
const issuance = {
  uuid: 'issuance',
  amount: '9007199254740993',
  recipientAddress: '0xrecipient',
  statusDisplay: 'Completed',
  createdAt: '2026-09-01',
  subscriptionReference: 'APP-9',
};
const request = {
  uuid: 'request',
  amount: 20,
  tokenSymbol: 'ORD',
  recipientAddress: '0xrecipient',
  statusDisplay: 'Rejected',
  reason: 'Member allotment',
  createdAt: '2026-09-01',
  rejectionReason: 'Missing resolution',
  executionNotes: 'First attempt refused',
};
const capital = {
  uuid: 'capital',
  purpose: 'Additional capital',
  additionalShares: 10,
  newAuthorizedTotal: 1010,
  status: 'draft',
  statusDisplay: 'Draft',
  createdAt: '2026-09-01',
};
const page = (rows: unknown[], next: string | null = null) => ({ data: { results: rows, count: rows.length, next } });
let client: QueryClient;
let read: (url: string, number: number) => Promise<unknown>;
let classRecord: typeof token;
let deployments: RegisterDeployment[];
let appointmentRows: OwnCompanyAppointment[];
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function screen() {
  return <TokenDetailScreen route={{ params: { uuid } }} navigation={{} as never} />;
}
function defaultRead(url: string, number: number): Promise<unknown> {
  if (url === URLS.REGISTER_DEPLOYMENTS) return Promise.resolve(page(deployments));
  if (url === URLS.REGISTER_CAPITAL_INCREASES || url === URLS.REGISTER_ISSUES || url === URLS.REGISTER_LINKS)
    return Promise.resolve(page([]));
  if (url === URLS.REGISTER_MEMBERS(uuid)) return Promise.resolve({ data: { members: [] } });
  if (
    url === '/api/v1/whitelist/company-wallet-nominations/' ||
    url === '/api/v1/whitelist/company-wallet-instructions/'
  )
    return Promise.resolve(page([]));
  if (url === APPOINTMENTS) return Promise.resolve(page(appointmentRows));
  if (url === URLS.DETAIL(uuid)) return Promise.resolve({ data: classRecord });
  if (url.includes('/companies/')) return Promise.resolve({ data: { uuid: 'company', status: 'active' } });
  if (url === URLS.HOLDERS(uuid)) return Promise.resolve({ data: register });
  if (url === URLS.ISSUANCES(uuid))
    return Promise.resolve(number === 1 ? page([], 'https://api.example.test/?page=2') : page([issuance]));
  if (url === URLS.ISSUANCE_REQUESTS)
    return Promise.resolve(number === 1 ? page([], 'https://api.example.test/?page=2') : page([request]));
  if (url === URLS.CAPITAL_INCREASES)
    return Promise.resolve(number === 1 ? page([], 'https://api.example.test/?page=2') : page([capital]));
  if (url === URLS.REGISTER_EXPORT(uuid))
    return Promise.resolve({ data: Uint8Array.from('member,shares', (c) => c.charCodeAt(0)).buffer });
  return Promise.reject(new Error(`Unexpected ${url}`));
}
beforeEach(() => {
  mockCompanyRole = 'company';
  resetFiles();
  classRecord = { ...token };
  deployments = [];
  appointmentRows = [];
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  read = defaultRead;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  get.mockReset();
  get.mockImplementation(
    (url, config) =>
      read(url, (config?.params as { page?: number } | undefined)?.page ?? 1) as ReturnType<typeof apiClient.get>,
  );
  post.mockReset();
  post.mockResolvedValue({ data: {} });
  jest.mocked(Sharing.shareAsync).mockClear();
});
afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('keeps the Share class title while the class is read', async () => {
  read = (url, number) => (url === URLS.DETAIL(uuid) ? new Promise(() => {}) : defaultRead(url, number));
  const view = await render(screen(), { wrapper });
  const title = view.getByRole('header', { name: 'Share class' });
  expect(title.parent!.parent!.children[1]).toBe(view.getByText('Loading share class…'));
});

it('reads every page of each history and keeps exact confirmed quantities and register state', async () => {
  jest.useFakeTimers();
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText('Application APP-9')).toBeTruthy());
  expect(view.getByText('9,007,199,254,740,993 shares to 0xrecipient')).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.WAITING_NOTE(2))).toBeTruthy();
  expect(view.getByText('Missing resolution')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Execution history request' }));
  expect(view.getByText('First attempt refused')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(
    URLS.ISSUANCES(uuid),
    expect.objectContaining({ params: { page: 2 }, ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(get).toHaveBeenCalledWith(
    URLS.ISSUANCE_REQUESTS,
    expect.objectContaining({ params: { token: uuid, page: 2 }, ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(get).toHaveBeenCalledWith(
    URLS.CAPITAL_INCREASES,
    expect.objectContaining({ params: { token: uuid, page: 2 }, ledovaSubmissionGuard: expect.any(Function) }),
  );
});

it.each([
  [URLS.ISSUANCES(uuid), 'issuances', 'No issuances yet.'],
  [URLS.ISSUANCE_REQUESTS, 'issuance requests', 'No issuance requests yet.'],
  [URLS.CAPITAL_INCREASES, 'authorised share requests', 'No authorised share requests yet.'],
])('does not call a failed second page an empty history: %s', async (url, label, empty) => {
  read = async (path, number) =>
    path === url && number === 2 ? Promise.reject(new Error('Unavailable')) : defaultRead(path, number);
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText(`We couldn’t load ${label}.`)).toBeTruthy());
  expect(view.queryByText(empty)).toBeNull();
  read = defaultRead;
  await fireEvent.press(view.getByRole('button', { name: `Retry ${label}` }));
  await waitFor(() => expect(view.queryByText(`We couldn’t load ${label}.`)).toBeNull());
});

it('shares an authenticated register copy and rejects a download from a retired session', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/register-ordinary.csv`, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    }),
  );
  expect(files.size).toBe(1);
  let finish!: (value: unknown) => void;
  read = async (url, number) =>
    url === URLS.REGISTER_EXPORT(uuid)
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaultRead(url, number);
  await waitFor(() => expect(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD }));
  await waitFor(() => expect(finish).toBeDefined());
  await act(() => invalidateSessionScope());
  await act(async () => finish(await defaultRead(URLS.REGISTER_EXPORT(uuid), 1)));
  await act(async () => {});
  expect(files.size).toBe(0);
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
});

const appointment: OwnCompanyAppointment = {
  uuid: 'appointment',
  company: 'company',
  companyName: 'Paper Company',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-07T00:00:00Z',
  source: 'invitation',
  declarationText: null,
  declarationVersion: null,
};
function prepared(body: RegisterDeploymentPreparation): RegisterDeployment {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: 'company',
    token: body.token,
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    createdAt: '2026-10-07T00:00:00Z',
    decisions: [],
    intentDigest: DIGEST,
    deploymentId: null,
    approvalDecision: null,
    execution: null,
    executionUnmetRequirements: [],
    snapshot: {
      company: { uuid: 'company', name: 'Paper Company', acn: '123456789', status: 'active' },
      token: {
        uuid,
        name: 'Ordinary shares',
        symbol: 'ORD',
        identifier: 'ORD-1',
        authorisedShares: '1000',
        decimals: 0,
      },
      issuerWallet: { address: `0x${'1'.repeat(40)}`, chain: 'base' },
      register: { present: false, initialized: null, uuid: null, sequence: null, headHash: null, issuedSupply: null },
      transaction: {
        chainId: 84532,
        sender: `0x${'2'.repeat(40)}`,
        to: `0x${'3'.repeat(40)}`,
        value: '0',
        data: '0x1234',
      },
    },
  };
}
function applied(proposal: RegisterDeployment, body: RegisterDeploymentDecideRequest): RegisterDeployment {
  const decidedAt = '2026-10-07T00:01:00Z';
  return {
    ...proposal,
    status: 'applied',
    stage: 'applied',
    deploymentId: KEY(91),
    approvalDecision: KEY(90),
    reviewedBy: 1,
    reviewedAt: decidedAt,
    decisions: [
      ...proposal.decisions,
      {
        uuid: KEY(92),
        kind: body.kind,
        decidedBy: 1,
        decidedByName: 'Synthetic Applier',
        appointment: body.appointment,
        idempotencyKey: body.idempotencyKey,
        digest: body.previewDigest,
        reason: body.reason ?? '',
        decidedAt,
      },
    ],
  };
}
async function appointee() {
  mockCompanyRole = 'investor';
  classRecord = { ...token, status: 'draft', statusDisplay: 'Draft', isOwner: false };
  appointmentRows = [appointment];
  const view = await render(screen(), { wrapper });
  await view.findByRole('button', { name: COPY.PREPARE });
  return view;
}

it('opens class metadata for an ordinary appointee and keeps private issuer history and actions owner-only', async () => {
  const view = await appointee();
  expect(view.getByText('Ordinary shares')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request issuance' })).toBeNull();
  expect(view.queryByText('Issuance requests')).toBeNull();
  for (const url of [URLS.ISSUANCES(uuid), URLS.ISSUANCE_REQUESTS, URLS.CAPITAL_INCREASES])
    expect(get.mock.calls.map(([path]) => path)).not.toContain(url);
  expect(get.mock.calls.some(([url]) => url.includes('/companies/'))).toBe(false);
  appointmentRows = [];
  await act(() => client.invalidateQueries({ queryKey: ['register-deployment-appointments'] }));
  await waitFor(() => expect(view.queryByRole('button', { name: COPY.PREPARE })).toBeNull());
  expect(post).not.toHaveBeenCalled();
});

it.each(['deploying', 'failed read', 'failed class', 'wrong-scope receipt', '403 response', '404 response'])(
  'recovers the exact preparation after an uncertain response and %s',
  async (state) => {
    let original!: RegisterDeploymentPreparation;
    let attempts = 0;
    post.mockImplementation(async (url, body) => {
      if (url !== URLS.REGISTER_DEPLOYMENTS) throw new Error('Unexpected write');
      original = body as RegisterDeploymentPreparation;
      if (++attempts === 1) {
        if (state === '403 response' || state === '404 response')
          throw {
            response: { status: Number(state.slice(0, 3)), data: { detail: 'Receipt is temporarily unavailable.' } },
          };
        if (state === 'wrong-scope receipt') return { data: { ...prepared(original), company: 'another-company' } };
        throw new Error('Response lost');
      }
      const result = prepared(original);
      deployments = [result];
      return { data: result };
    });
    const view = await appointee();
    await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
    await view.findByRole('button', { name: 'Recover preparation receipt' });
    const body = { ...original };
    appointmentRows = [];
    classRecord = {
      ...classRecord,
      status: state === 'failed class' ? 'failed' : 'deploying',
      statusDisplay: state === 'failed class' ? 'Failed' : 'Deploying',
    };
    if (state === 'failed read')
      read = async (url, number) =>
        url === URLS.DETAIL(uuid) ? Promise.reject(new Error('Unavailable')) : defaultRead(url, number);
    await act(() =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['company-token', uuid] }),
        client.invalidateQueries({ queryKey: ['register-deployment-appointments'] }),
      ]),
    );
    await fireEvent.press(view.getByRole('button', { name: 'Recover preparation receipt' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][1]).toEqual(body);
    expect(post.mock.calls[1][1]).toEqual(body);
    await waitFor(() => expect(view.queryByRole('button', { name: 'Recover preparation receipt' })).toBeNull());
    expect(view.getByText(COPY.STAGES.submitted)).toBeTruthy();
  },
);

it.each([null, 403, 404])(
  'keeps apply recovery above changed stage, lost appointment and a missing consumed approval after status %s',
  async (status) => {
    const proposal = {
      ...prepared({ operationId: KEY(20), appointment: appointment.uuid, token: uuid }),
      stage: 'approved',
    };
    deployments = [proposal];
    let body!: RegisterDeploymentDecideRequest;
    let response!: RegisterDeployment;
    let attempts = 0;
    post.mockImplementation(async (url, request) => {
      if (url === URLS.REGISTER_DEPLOYMENT_PREVIEW(proposal.uuid))
        return {
          data: {
            snapshot: proposal.snapshot,
            intentDigest: proposal.intentDigest,
            previewDigest: DIGEST,
            canDecide: true,
            unmetRequirements: [],
            approvalDecision: KEY(90),
            deploymentId: null,
          },
        };
      if (url === URLS.REGISTER_DEPLOYMENT_DECIDE(proposal.uuid)) {
        body = request as RegisterDeploymentDecideRequest;
        response = applied(proposal, body);
        deployments = [response];
        if (++attempts === 1) {
          if (status) throw { response: { status, data: { detail: 'Receipt is temporarily unavailable.' } } };
          throw new Error('Response lost');
        }
        if (attempts === 2) return { data: { ...response, approvalDecision: null } };
        return { data: response };
      }
      throw new Error('Unexpected write');
    });
    const view = await appointee();
    await fireEvent.press(view.getByRole('button', { name: /Apply deployment the deployment/ }));
    await view.findByText(COPY.CONFIRMATIONS.apply);
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    await view.findByRole('button', { name: /Recover apply deployment receipt for/ });
    const original = { ...body };
    appointmentRows = [];
    await act(() =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['register-deployments'] }),
        client.invalidateQueries({ queryKey: ['register-deployment-appointments'] }),
      ]),
    );
    await waitFor(() => expect(view.queryByRole('button', { name: /Apply deployment the deployment/ })).toBeNull());
    await fireEvent.press(view.getByRole('button', { name: /Recover apply deployment receipt for/ }));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() =>
      expect(view.getByRole('button', { name: /Recover apply deployment receipt for/ })).toBeEnabled(),
    );
    await fireEvent.press(view.getByRole('button', { name: /Recover apply deployment receipt for/ }));
    await waitFor(() => expect(attempts).toBe(3));
    expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_DEPLOYMENT_PREVIEW(proposal.uuid))).toHaveLength(1);
    expect(
      post.mock.calls
        .filter(([url]) => url === URLS.REGISTER_DEPLOYMENT_DECIDE(proposal.uuid))
        .map(([, request]) => request),
    ).toEqual([original, original, original]);
    await waitFor(() =>
      expect(view.queryByRole('button', { name: /Recover apply deployment receipt for/ })).toBeNull(),
    );
    expect(view.getByText('Admitted; execution pending')).toBeTruthy();
    expect(view.getByText(COPY.ADMITTED_NOTE)).toBeTruthy();
  },
);

it.each([
  [
    { present: false, initialized: null, uuid: null, sequence: null, headHash: null, issuedSupply: null },
    'Absent',
    'Not recorded',
  ],
  [
    { present: true, initialized: false, uuid: 'register', sequence: 0, headHash: '', issuedSupply: '0' },
    'Present, unopened',
    '0',
  ],
  [
    { present: true, initialized: true, uuid: 'register', sequence: 1, headHash: DIGEST, issuedSupply: '0' },
    'Opened',
    '0',
  ],
] as const)(
  'shows retained register presence and opening separately from zero shares',
  async (registerState, label, shares) => {
    const proposal = prepared({ operationId: KEY(20), appointment: appointment.uuid, token: uuid });
    proposal.snapshot.register = { ...registerState };
    deployments = [proposal];
    const view = await appointee();
    await waitFor(() => expect(view.getAllByText(label).length).toBeGreaterThan(0));
    expect(view.getAllByText(shares).length).toBeGreaterThan(0);
    expect(view.getByText(proposal.snapshot.issuerWallet.address)).toBeTruthy();
    expect(view.getByText(proposal.snapshot.transaction.to)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  },
);

it.each(['account', 'epoch', 'unmount'])(
  'drops an open deployment decision when the %s boundary changes',
  async (boundary) => {
    const proposal = prepared({ operationId: KEY(20), appointment: appointment.uuid, token: uuid });
    deployments = [proposal];
    post.mockImplementation(async (url) => {
      if (url === URLS.REGISTER_DEPLOYMENT_PREVIEW(proposal.uuid))
        return {
          data: {
            snapshot: proposal.snapshot,
            intentDigest: DIGEST,
            previewDigest: DIGEST,
            canDecide: true,
            unmetRequirements: [],
            approvalDecision: null,
            deploymentId: null,
          },
        };
      throw new Error('No decision should be sent');
    });
    const view = await appointee();
    await fireEvent.press(view.getByRole('button', { name: /Approve deployment the deployment/ }));
    await view.findByText(COPY.CONFIRMATIONS.approve);
    const confirm = view.getByRole('button', { name: 'Confirm' });
    if (boundary === 'account')
      await act(() =>
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'native-user', userAccount: { uuid: 'other-account', role: 'investor' } },
        }),
      );
    else if (boundary === 'epoch') await act(() => invalidateSessionScope());
    else {
      const config = post.mock.calls.find(([url]) => url === URLS.REGISTER_DEPLOYMENT_PREVIEW(proposal.uuid))?.[2];
      await view.unmount();
      expect(() => config?.ledovaSubmissionGuard?.()).toThrow();
    }
    if (boundary !== 'unmount') await fireEvent.press(confirm);
    expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_DEPLOYMENT_DECIDE(proposal.uuid))).toHaveLength(0);
  },
);

it('checks the final sharing callback after writing a register copy', async () => {
  const nativeFiles = jest.requireActual('../../testSupport/documentFiles').nativeFileSystem;
  const write = nativeFiles.File.prototype.write;
  jest.spyOn(nativeFiles.File.prototype, 'write').mockImplementation(function (this: unknown, bytes: unknown) {
    write.call(this, bytes);
    invalidateSessionScope();
  });
  const view = await render(screen(), { wrapper });
  await view.findByRole('button', { name: REGISTER_COPY.DOWNLOAD });
  await waitFor(() => expect(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD }));
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      URLS.REGISTER_EXPORT(uuid),
      expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
    ),
  );
  await act(async () => {});
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('keeps a held original deployment separate from its later projection and swap approval', async () => {
  const proposal: RegisterDeployment = {
    ...prepared({ operationId: KEY(20), appointment: appointment.uuid, token: uuid }),
    status: 'applied',
    stage: 'applied',
    deploymentId: KEY(91),
    approvalDecision: KEY(90),
    executionUnmetRequirements: ['source_lock_busy'],
    execution: {
      deployment: KEY(91),
      operationId: KEY(93),
      claimId: null,
      operationStatus: 'preparing',
      txHash: null,
      contractAddress: null,
      attributionRequired: false,
      projectedAt: null,
      swapApprovalOutcome: null,
    },
  };
  deployments = [proposal];
  const view = await appointee();
  await view.findByText('Execution held');
  expect(view.queryByText('Confirmed and projected')).toBeNull();
  expect(view.getByText(proposal.snapshot.issuerWallet.address)).toBeTruthy();
  deployments = [
    {
      ...proposal,
      executionUnmetRequirements: [],
      execution: {
        ...proposal.execution!,
        operationStatus: 'confirmed',
        projectedAt: '2026-10-07T00:03:00Z',
        contractAddress: `0x${'4'.repeat(40)}`,
        txHash: `0x${'5'.repeat(64)}`,
        swapApprovalOutcome: 'failed',
      },
    },
  ];
  classRecord = { ...classRecord, status: 'deployed', statusDisplay: 'Deployed' };
  await fireEvent.press(view.getByRole('button', { name: 'Refresh deployment records' }));
  await view.findByText('Confirmed and projected');
  expect(view.getByText(`0x${'4'.repeat(40)}`)).toBeTruthy();
  expect(view.getByText('failed')).toBeTruthy();
  expect(view.getByText(proposal.snapshot.issuerWallet.address)).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('refuses a malformed preview digest before making a decision request', async () => {
  const proposal = prepared({ operationId: KEY(20), appointment: appointment.uuid, token: uuid });
  deployments = [proposal];
  post.mockResolvedValue({
    data: {
      snapshot: proposal.snapshot,
      intentDigest: DIGEST,
      previewDigest: 'not-an-exact-digest',
      canDecide: true,
      unmetRequirements: [],
      approvalDecision: null,
      deploymentId: null,
    },
  });
  const view = await appointee();
  await fireEvent.press(view.getByRole('button', { name: /Approve deployment the deployment/ }));
  await view.findByText(COPY.PREVIEW_FAILED);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  expect(view.queryByText(COPY.CONFIRMATIONS.approve)).toBeNull();
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_DEPLOYMENT_DECIDE(proposal.uuid))).toHaveLength(0);
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
});

it.each([
  ['failed', 'Failed before signing'],
  ['reverted', 'Transaction reverted'],
])('shows the original %s execution before outstanding source holds', async (operationStatus, label) => {
  deployments = [
    {
      ...prepared({ operationId: KEY(20), appointment: appointment.uuid, token: uuid }),
      status: 'applied',
      stage: 'applied',
      deploymentId: KEY(91),
      approvalDecision: KEY(90),
      executionUnmetRequirements: ['source_lock_busy'],
      execution: {
        deployment: KEY(91),
        operationId: KEY(93),
        claimId: null,
        operationStatus,
        txHash: null,
        contractAddress: null,
        attributionRequired: false,
        projectedAt: null,
        swapApprovalOutcome: null,
      },
    },
  ];
  const view = await appointee();
  await view.findByText(label);
  expect(view.queryByText('Execution held')).toBeNull();
  expect(view.queryByText('Confirmed and projected')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});
