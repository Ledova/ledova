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
  type RegisterIssue,
  type RegisterIssuePreparation,
  type RegisterIssueDecideRequest,
  type RegisterIssueDecisionPreview,
  type RegisterLink,
  type RegisterLinkPreparation,
  type CompanyWalletInstruction,
  type CompanyWalletNomination,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope } from '../../services/sessionScope';
import { pickedFile, resetFiles, files, nativeFileSystem } from '../../testSupport/documentFiles';
import { TokenDetailScreen } from './TokenDetailScreen';

jest.mock('../../services/apiClient', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), defaults: { transformRequest: [] } },
}));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = ID(100);
const COMPANY = ID(101);
const MEMBER = ID(102);
const NOMINATION = ID(103);
const APPROVAL = ID(104);
const ADDRESS = `0x${'1'.repeat(40)}`;
const DIGEST = 'd'.repeat(64);
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const NOMINATIONS = '/api/v1/whitelist/company-wallet-nominations/';
const APPROVALS = '/api/v1/whitelist/company-wallet-instructions/';
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
const nominee: CompanyWalletNomination = {
  uuid: NOMINATION,
  company: COMPANY,
  address: ADDRESS,
  chain: 'base',
  request: ID(106),
  decision: ID(107),
  digest: DIGEST,
  proofCompletedAt: '2026-10-01T00:00:00Z',
  eligibilityExpiresAt: '2099-01-01T00:00:00Z',
  submittedAt: '2026-10-01T00:00:00Z',
  unmetRequirements: [],
};
const approvedWallet = {
  uuid: ID(108),
  operationId: ID(108),
  company: COMPANY,
  nomination: NOMINATION,
  action: 'add',
  changeId: APPROVAL,
  expiresAt: '2098-01-01T00:00:00Z',
  status: 'applied',
  stage: 'applied',
  preparingAppointment: appointment.uuid,
  preparedByName: 'Synthetic Preparer',
  providedBy: 'company',
  createdAt: '2026-10-01T00:00:00Z',
  intentDigest: DIGEST,
  approvalDecision: ID(109),
  decisions: [],
  executionUnmetRequirements: [],
  targetChange: null,
  rejectionReason: '',
  reviewedAt: '2026-10-01T00:01:00Z',
  reviewedBy: 1,
  submittedBy: 1,
  execution: {
    change: APPROVAL,
    status: 'confirmed',
    operationId: ID(110),
    operationStatus: 'confirmed',
    claimId: ID(111),
    txHash: `0x${'3'.repeat(64)}`,
    completedAt: '2026-10-01T00:02:00Z',
    transaction: ID(112),
    blockNumber: 1,
    blockHash: `0x${'4'.repeat(64)}`,
    failureCode: '',
  },
  snapshot: {
    company: { uuid: COMPANY, name: 'Synthetic Company', acn: '123456789', status: 'active' },
    source: {
      nomination: NOMINATION,
      request: nominee.request,
      decision: nominee.decision,
      proofCompletedAt: nominee.proofCompletedAt,
      eligibilityExpiresAt: nominee.eligibilityExpiresAt,
      targetChange: null,
    },
    target: {
      address: ADDRESS,
      chain: 'base',
      chainId: 84532,
      registryAddress: `0x${'5'.repeat(40)}`,
      expiresAt: '2098-01-01T00:00:00Z',
    },
    transaction: {
      chainId: 84532,
      sender: `0x${'6'.repeat(40)}`,
      to: `0x${'5'.repeat(40)}`,
      value: '0',
      data: '0x1234',
    },
  },
} as CompanyWalletInstruction;
const member = {
  member: MEMBER,
  name: 'Synthetic Employee',
  residentialAddress: '1 Synthetic Street',
  currentShares: '0',
  enteredOn: '2026-10-01',
  lastCeasedOn: null,
  particularsRetained: true,
  walletless: false,
};
const snapshot = {
  company: { uuid: COMPANY, name: 'Synthetic Company', acn: '123456789', status: 'active' },
  token: {
    uuid: TOKEN,
    name: 'Ordinary shares',
    symbol: 'ORD',
    chain: 'base',
    contractAddress: token.contractAddress,
    authorisedShares: '1000',
  },
  member: {
    uuid: MEMBER,
    name: member.name,
    residentialAddress: member.residentialAddress,
    identitySource: 'documented_member',
    address: ADDRESS,
  },
  wallet: {
    nomination: NOMINATION,
    approval: APPROVAL,
    address: ADDRESS,
    registryAddress: approvedWallet.snapshot.target.registryAddress,
    chainId: 84532,
    expiresAt: approvedWallet.expiresAt!,
    proofCompletedAt: nominee.proofCompletedAt,
    eligibilityExpiresAt: nominee.eligibilityExpiresAt,
  },
  register: { uuid: ID(113), opening: ID(114), sequence: 1, headHash: DIGEST, issuedSupply: '0', currentShares: '0' },
  transaction: { chainId: 84532, sender: `0x${'6'.repeat(40)}`, to: token.contractAddress, value: '0', data: '0x1234' },
};
let client: QueryClient;
let classRecord = { ...token };
let appointments: OwnCompanyAppointment[];
let nominees: CompanyWalletNomination[];
let walletApprovals: CompanyWalletInstruction[];
let links: RegisterLink[];
let issues: RegisterIssue[];
let members = [member];
let failClass: boolean;
let failIssues: boolean;
let failNominations: boolean;
let issueAnswer: jest.Mock;
let linkAnswer: jest.Mock;
let fileAnswer: jest.Mock;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
const page = (results: unknown[]) => ({ data: { results, count: results.length, next: null, previous: null } });
function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}
function linkFrom(body: RegisterLinkPreparation): RegisterLink {
  return {
    sourceDocument: null,
    uuid: body.operationId,
    company: COMPANY,
    preparingAppointment: body.appointment,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    mapping: body.mapping,
    mappingSummary: body.mapping.map((row) => ({ ...row, memberExists: row.member === MEMBER })),
    authority: body.authority,
    approvingDirector: body.approvingDirector ?? '',
    authorityReference: body.authorityReference,
    reason: body.reason,
    providedBy: 'company',
    preparedByName: 'Synthetic Preparer',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-01T00:00:00Z',
  };
}
function issueFrom(body: RegisterIssuePreparation): RegisterIssue {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: body.token,
    member: body.member,
    nomination: body.nomination,
    walletApproval: body.walletApproval,
    request: ID(115),
    shares: body.shares,
    termsOn: body.termsOn,
    terms: body.terms,
    acceptanceRequired: body.acceptanceRequired,
    approvingDirector: body.approvingDirector,
    authorityReference: body.authorityReference,
    reason: body.reason,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    termsEvidence: body.termsEvidence,
    termsFingerprint: 'b'.repeat(64),
    termsSnapshot: {},
    acceptanceEvidence: body.acceptanceEvidence ?? null,
    acceptanceFingerprint: body.acceptanceEvidence ? 'c'.repeat(64) : '',
    acceptanceSnapshot: body.acceptanceEvidence ? {} : null,
    snapshot: { ...snapshot, member: { ...snapshot.member, uuid: body.member } },
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
  return issueFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    token: TOKEN,
    member: MEMBER,
    nomination: NOMINATION,
    walletApproval: APPROVAL,
    shares: '25',
    termsOn: '2020-01-01',
    terms: 'Outright non-paid employee grant',
    approvingDirector: 'Independent Director',
    authorityReference: 'RES-1',
    reason: 'Employee grant',
    acceptanceRequired: true,
    authorityEvidence: ID(121),
    termsEvidence: ID(122),
    acceptanceEvidence: ID(123),
  });
}
function preview(record: RegisterIssue, canDecide = true): RegisterIssueDecisionPreview {
  if (
    record.shares === null ||
    record.termsOn === null ||
    record.terms === null ||
    record.acceptanceRequired === null ||
    typeof record.intentDigest !== 'string'
  )
    throw new Error('This current company fixture requires actual non-paid grant terms.');
  return {
    previewDigest: DIGEST,
    canDecide,
    unmetRequirements: canDecide ? [] : ['insufficient_headroom'],
    snapshot: record.snapshot,
    intentDigest: record.intentDigest,
    approvalDecision: record.approvalDecision,
    shares: record.shares,
    termsOn: record.termsOn,
    terms: record.terms,
    acceptanceRequired: record.acceptanceRequired,
    approvingDirector: record.approvingDirector,
    authorityReference: record.authorityReference,
    reason: record.reason,
    registerSequence: 1,
    issuedSupply: '0',
    reservedShares: '0',
    authorisedSupply: '1000',
    availableShares: '1000',
    afterIssuedSupply: '25',
    currentShares: '0',
    afterShares: '25',
  };
}
function executeGuards(config: Parameters<typeof apiClient.post>[2], body: unknown) {
  config?.ledovaSubmissionGuard?.();
  const transformers = config?.transformRequest;
  const context = { ...config, headers: new AxiosHeaders() };
  for (const transform of Array.isArray(transformers) ? transformers : transformers ? [transformers] : [])
    transform.call(context, body, context.headers);
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function screen() {
  return <TokenDetailScreen route={{ params: { uuid: TOKEN } }} />;
}
async function open() {
  const view = await render(screen(), { wrapper });
  await view.findByRole('button', { name: `Use nominated wallet ${ADDRESS}` });
  return view;
}
async function fill(view: Awaited<ReturnType<typeof open>>, accept = true) {
  await fireEvent.press(view.getByRole('button', { name: `Use nominated wallet ${ADDRESS}` }));
  await fireEvent.press(view.getByRole('button', { name: `Use member ${member.name} ${MEMBER}` }));
  await fireEvent.press(view.getByRole('button', { name: `Use company wallet approval ${APPROVAL}` }));
  for (const [label, value] of [
    ['Approving director', ' Independent Director '],
    ['Company authority reference', ' RES-1 '],
    ['Reason for grant or wallet link', ' Employee grant '],
    ['Shares to grant', '25'],
    ['Terms dated on', '2020-01-01'],
    ['Non-paid grant terms', ' Outright non-paid employee grant '],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(
    view.getByRole('button', {
      name: accept ? 'Terms require recipient acceptance' : 'Terms do not require recipient acceptance',
    }),
  );
  for (const noun of ['authority', 'terms', ...(accept ? ['acceptance'] : [])]) {
    await fireEvent.press(view.getByRole('button', { name: `Choose the ${noun} document` }));
    await view.findByRole('button', { name: `Replace the ${noun} document` });
  }
}
const submissions = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_ISSUES);
beforeEach(() => {
  resetFiles();
  classRecord = { ...token };
  appointments = [appointment];
  nominees = [nominee];
  walletApprovals = [approvedWallet];
  issues = [];
  members = [member];
  failClass = false;
  failIssues = false;
  failNominations = false;
  links = [
    {
      ...linkFrom({
        operationId: ID(124),
        companyId: COMPANY,
        appointment: appointment.uuid,
        authorityEvidence: ID(125),
        authority: 'director_resolution',
        approvingDirector: 'Independent Director',
        authorityReference: 'LINK-1',
        reason: 'Documented member link',
        mapping: [{ address: ADDRESS, member: MEMBER }],
      }),
      status: 'applied',
      stage: 'applied',
    },
  ];
  let keys = 200;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => ID(++keys) as ReturnType<typeof Crypto.randomUUID>);
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
          issuedSupply: '0',
          waitingEffects: 0,
          totalHolders: 0,
          holders: [],
        },
      };
    if (url === URLS.REGISTER_CAPITAL_INCREASES || url === URLS.REGISTER_DEPLOYMENTS) return page([]);
    if (url === NOMINATIONS) {
      if (failNominations) throw new Error('Unavailable selected nomination');
      return page(nominees);
    }
    if (url === APPROVALS) return page(walletApprovals);
    if (url === URLS.REGISTER_MEMBERS(TOKEN)) return { data: { members } };
    if (url === URLS.REGISTER_LINKS) return page(links);
    if (url === URLS.REGISTER_ISSUES) {
      if (failIssues) throw new Error('Unavailable grant history');
      return page(issues);
    }
    if (url.endsWith('/file/') || url.endsWith('/terms-file/') || url.endsWith('/acceptance-file/'))
      return fileAnswer();
    throw new Error(`Unexpected ${url}`);
  });
  issueAnswer = jest.fn(async (body: RegisterIssuePreparation) => {
    const record = issueFrom(body);
    issues = [record];
    return { data: record };
  });
  linkAnswer = jest.fn(async (body: RegisterLinkPreparation) => {
    const record = linkFrom(body);
    links = [record];
    return { data: record };
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
    if (url === URLS.REGISTER_ISSUES) return issueAnswer(body);
    if (url === URLS.REGISTER_LINKS) return linkAnswer(body);
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(async () => {
  await waitFor(() => {
    expect(client.isFetching()).toBe(0);
    expect(client.isMutating()).toBe(0);
  });
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('prepares an exact nominated linked non-paid grant with actual terms and required acceptance without owner histories or address input', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await waitFor(() => expect(submissions()).toHaveLength(1));
  await view.findByText('No issue execution admitted');
  expect(submissions()[0]![1]).toEqual(
    expect.objectContaining({
      token: TOKEN,
      member: MEMBER,
      nomination: NOMINATION,
      walletApproval: APPROVAL,
      shares: '25',
      termsOn: '2020-01-01',
      terms: 'Outright non-paid employee grant',
      approvingDirector: 'Independent Director',
      acceptanceRequired: true,
      acceptanceEvidence: expect.any(String),
    }),
  );
  expect(submissions()[0]![1]).not.toHaveProperty('recipient');
  expect(submissions()[0]![1]).not.toHaveProperty('payment');
  expect(submissions()[0]![1]).not.toHaveProperty('effectiveOn');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  for (const url of [
    URLS.ISSUANCES(TOKEN),
    URLS.ISSUANCE_REQUESTS,
    URLS.CAPITAL_INCREASES,
    '/api/v1/wallets/',
    '/api/v1/company-eligibility/requests/',
  ])
    expect(get.mock.calls.map(([path]) => path)).not.toContain(url);
  expect(view.queryByLabelText('Recipient address')).toBeNull();
});

it('keeps required acceptance and exact request range explicit before creating any issue', async () => {
  const view = await open();
  await fill(view, false);
  for (const quantity of ['1.5', '1e3', '-1', '0', '2147483648', '9007199254740993']) {
    await fireEvent.changeText(view.getByLabelText('Shares to grant'), quantity);
    expect(view.getByRole('button', { name: 'Prepare company grant' })).toBeDisabled();
  }
  await fireEvent.changeText(view.getByLabelText('Shares to grant'), '2147483647');
  expect(view.getByRole('button', { name: 'Prepare company grant' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Terms require recipient acceptance' }));
  expect(view.getByRole('button', { name: 'Prepare company grant' })).toBeDisabled();
  expect(submissions()).toHaveLength(0);
});

it('does not pair a separate confirmed ADD by address with the selected nomination', async () => {
  walletApprovals = [{ ...approvedWallet, nomination: ID(999) }];
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: `Use nominated wallet ${ADDRESS}` }));
  expect(view.queryByRole('button', { name: `Use company wallet approval ${APPROVAL}` })).toBeNull();
  expect(submissions()).toHaveLength(0);
});

it('lets a read-register-only appointee read retained grant facts and files without preparation or any POST', async () => {
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  issues = [prepared()];
  const view = await render(screen(), { wrapper });
  await view.findByText('No issue execution admitted');
  expect(view.queryByRole('button', { name: 'Prepare company grant' })).toBeNull();
  expect(view.queryByRole('button', { name: /^Approve the company grant/ })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: /^Download terms document of company grant/ }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(post).not.toHaveBeenCalled();
});

it.each([403, 404, 503])(
  'recovers the identical original full preparation after %s despite losing fresh prepare and class readiness',
  async (status) => {
    issueAnswer.mockRejectedValueOnce({ response: { status } });
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
    await view.findByRole('button', { name: 'Recover company preparation receipt' });
    const original = submissions()[0]![1];
    appointments = [{ ...appointment, capabilities: ['read_register'] }];
    failClass = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
      await client.invalidateQueries({ predicate: (query) => query.queryKey.includes('company-issue-appointments') });
    });
    await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
    await view.findByRole('button', { name: 'Recover company preparation receipt' });
    await fireEvent.press(view.getByRole('button', { name: 'Recover company preparation receipt' }));
    await waitFor(() => expect(submissions()).toHaveLength(2));
    expect(submissions()[1]![1]).toEqual(original);
    await view.findByText('No issue execution admitted');
    expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  },
);

it.each([400, 409])(
  'clears definitively refused preparation on %s without presenting uncertain recovery',
  async (status) => {
    issueAnswer.mockRejectedValueOnce({ response: { status } });
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
    await waitFor(() => expect(submissions()).toHaveLength(1));
    await waitFor(() => expect(view.getByRole('button', { name: 'Prepare company grant' })).toBeEnabled());
    expect(view.queryByRole('button', { name: 'Recover company preparation receipt' })).toBeNull();
  },
);

it.each(['account', 'epoch', 'session'] as const)(
  'hides old private inputs and blocks delayed actual transport after %s change',
  async (boundary) => {
    let finish!: (value: unknown) => void;
    issueAnswer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
    await waitFor(() => expect(submissions()).toHaveLength(1));
    const config = submissions()[0]![2]!;
    await act(() => {
      if (boundary === 'account')
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'native-user', userAccount: { uuid: 'other-account', role: 'investor' } },
        });
      else if (boundary === 'session') {
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
      } else invalidateSessionScope();
    });
    expect(() => config.ledovaSubmissionGuard!()).toThrow();
    await act(async () => finish({ data: issueFrom(submissions()[0]![1] as RegisterIssuePreparation) }));
    await waitFor(() => expect(view.getByLabelText('Non-paid grant terms').props.value).toBe(''));
    expect(view.queryByText('No issue execution admitted')).toBeNull();
  },
);

it('blocks a stale source at actual dispatch and accepts a healthy refreshed selected source', async () => {
  const view = await open();
  await fill(view);
  const original = post.getMockImplementation()!;
  post.mockImplementationOnce(async (url, body, config) => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
    });
    await client.invalidateQueries({
      predicate: (query) => query.queryKey.includes('company-issue-nominations'),
      refetchType: 'none',
    });
    return original(url, body, config);
  });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await waitFor(() => expect(view.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(submissions()).toHaveLength(0);
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Prepare company grant' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText('No issue execution admitted');
  expect(submissions()).toHaveLength(1);
});

it('refuses a retained file callback after private read access is lost and permits a healthy retained file', async () => {
  issues = [prepared()];
  const view = await open();
  let complete!: (value: unknown) => void;
  fileAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: /^Download terms document of company grant/ }));
  await waitFor(() => expect(fileAnswer).toHaveBeenCalledTimes(1));
  appointments = [{ ...appointment, status: 'revoked', isEffective: false, revokedAt: '2026-10-01T00:00:00Z' }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await act(async () =>
    complete({ data: Uint8Array.from([1, 2]).buffer, headers: { 'content-type': 'application/pdf' } }),
  );
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect([...files.keys()].some((uri) => uri.includes('/ledova-document-views-v1/'))).toBe(false);
  appointments = [appointment];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await view.findByRole('button', { name: /^Download terms document of company grant/ });
  await fireEvent.press(view.getByRole('button', { name: /^Download terms document of company grant/ }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
});

function decided(record: RegisterIssue, body: RegisterIssueDecideRequest): RegisterIssue {
  if (!record.request) throw new Error('This current company fixture requires its actual issuance request.');
  const decision = {
    uuid: ID(401),
    kind: body.kind,
    appointment: body.appointment,
    idempotencyKey: body.idempotencyKey,
    digest: body.previewDigest,
    reason: body.reason ?? '',
    decidedBy: 1,
    decidedByName: 'Synthetic Company Appointee',
    decidedAt: '2026-10-08T00:00:00Z',
  };
  return {
    ...record,
    decisions: [...record.decisions, decision],
    stage: body.kind === 'approve' ? 'approved' : body.kind === 'apply' ? 'applied' : 'rejected',
    status: body.kind === 'approve' ? 'submitted' : body.kind === 'apply' ? 'applied' : 'rejected',
    reviewedAt: body.kind === 'approve' ? null : decision.decidedAt,
    rejectionReason: body.kind === 'reject' ? decision.reason : '',
    execution:
      body.kind === 'apply'
        ? {
            execution: ID(402),
            status: 'queued',
            request: record.request,
            dispatchId: ID(403),
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
          }
        : null,
  };
}

it.each(['approve', 'apply', 'reject'] as const)(
  'uses a narrow %s appointment for exact preview and decision without issuer histories',
  async (kind) => {
    appointments = [{ ...appointment, capabilities: [kind === 'reject' ? 'approve' : kind] }];
    const record = { ...prepared(), ...(kind === 'apply' ? { stage: 'approved', approvalDecision: ID(400) } : {}) };
    issues = [record];
    const original = post.getMockImplementation()!;
    post.mockImplementation(async (url, body, config) => {
      executeGuards(config, body);
      if (url === URLS.REGISTER_ISSUE_PREVIEW(record.uuid)) return { data: preview(record) };
      if (url === URLS.REGISTER_ISSUE_DECIDE(record.uuid)) {
        const applied = decided(record, body as RegisterIssueDecideRequest);
        issues = [applied];
        return { data: applied };
      }
      return original(url, body, config);
    });
    const view = await render(screen(), { wrapper });
    const label = kind[0]!.toUpperCase() + kind.slice(1);
    await view.findByRole('button', { name: new RegExp(`^${label} the company grant`) });
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${label} the company grant`) }));
    if (kind === 'reject') {
      await view.findByLabelText('Reason for rejection');
      await fireEvent.changeText(view.getByLabelText('Reason for rejection'), 'Wrong recipient terms');
      await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
    }
    await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_ISSUE_DECIDE(record.uuid))).toHaveLength(1),
    );
    await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
    const decision = post.mock.calls.find(([url]) => url === URLS.REGISTER_ISSUE_DECIDE(record.uuid))!;
    expect(decision[1]).toEqual(
      expect.objectContaining({ appointment: appointment.uuid, kind, previewDigest: DIGEST, confirmation: true }),
    );
    expect(decision[2]).toEqual(
      expect.objectContaining({ ledovaSessionEpoch: expect.any(Number), ledovaSubmissionGuard: expect.any(Function) }),
    );
    if (kind === 'apply') {
      expect(view.getByText('Original issue admitted; execution queued')).toBeTruthy();
      expect(view.queryByText('Finalised mint recorded in the register')).toBeNull();
    }
    for (const path of [URLS.ISSUANCES(TOKEN), URLS.ISSUANCE_REQUESTS, URLS.CAPITAL_INCREASES])
      expect(get.mock.calls.map(([url]) => url)).not.toContain(path);
  },
);

it('keeps an original apply decision mounted after a lost response and recovers under current read access after stage and class change', async () => {
  const record = { ...prepared(), stage: 'approved', approvalDecision: ID(400) };
  issues = [record];
  let originalBody: RegisterIssueDecideRequest;
  let attempts = 0;
  const original = post.getMockImplementation()!;
  post.mockImplementation(async (url, body, config) => {
    executeGuards(config, body);
    if (url === URLS.REGISTER_ISSUE_PREVIEW(record.uuid)) return { data: preview(record) };
    if (url === URLS.REGISTER_ISSUE_DECIDE(record.uuid)) {
      attempts++;
      if (attempts === 1) {
        originalBody = body as RegisterIssueDecideRequest;
        issues = [decided(record, originalBody)];
        throw { response: { status: 503 } };
      }
      expect(body).toEqual(originalBody!);
      return { data: issues[0] };
    }
    return original(url, body, config);
  });
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: /^Apply the company grant/ }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await view.findByRole('button', { name: /^Recover apply receipt for company grant/ });
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  failClass = true;
  await act(async () => client.invalidateQueries({ queryKey: ['company-token', TOKEN] }));
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await view.findByRole('button', { name: /^Recover apply receipt for company grant/ });
  await fireEvent.press(view.getByRole('button', { name: /^Recover apply receipt for company grant/ }));
  await waitFor(() => expect(attempts).toBe(2));
  await waitFor(() => expect(view.queryByRole('button', { name: /^Recover apply receipt/ })).toBeNull());
  expect(view.getByText('Original issue admitted; execution queued')).toBeTruthy();
});

it('creates a zero-balance member through a genuine selected-nomination LINK and its company approve/apply before grant preparation', async () => {
  links = [];
  members = [];
  const original = post.getMockImplementation()!;
  post.mockImplementation(async (url, raw, config) => {
    executeGuards(config, raw);
    const body = raw as RegisterIssueDecideRequest;
    if (url.includes('/register-links/') && url.endsWith('/decision-preview/'))
      return {
        data: {
          previewDigest: DIGEST,
          unmetRequirements: [],
          canDecide: true,
          links: links[0]!.mapping.map((mapping) => ({
            ...mapping,
            memberExists: false,
            walletProof: 'proven',
            holderType: 'member',
            holderName: 'Synthetic Employee',
          })),
        },
      };
    if (url.includes('/register-links/') && url.endsWith('/decide/')) {
      const decision = {
        uuid: ID(body.kind === 'apply' ? 451 : 450),
        kind: body.kind,
        appointment: body.appointment,
        idempotencyKey: body.idempotencyKey,
        digest: body.previewDigest,
        reason: '',
        decidedBy: 1,
        decidedByName: 'Synthetic Company Appointee',
        decidedAt: '2026-10-08T00:00:00Z',
      };
      const link = {
        ...links[0]!,
        decisions: [...links[0]!.decisions, decision],
        stage: body.kind === 'apply' ? 'applied' : 'approved',
        status: body.kind === 'apply' ? ('applied' as const) : ('submitted' as const),
        reviewedAt: body.kind === 'apply' ? decision.decidedAt : null,
      };
      links = [link];
      if (body.kind === 'apply') members = [{ ...member, member: link.mapping[0]!.member }];
      return { data: link };
    }
    return original(url, raw, config);
  });
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: `Use nominated wallet ${ADDRESS}` }));
  await fireEvent.press(view.getByRole('button', { name: 'Use a new member' }));
  for (const [label, value] of [
    ['Approving director', 'Independent Director'],
    ['Company authority reference', 'LINK-1'],
    ['Reason for grant or wallet link', 'Link the chosen participant'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare selected wallet link' }));
  await view.findByText('Prepared wallet link');
  expect(links[0]!.mapping).toEqual([{ address: ADDRESS, member: ID(201) }]);
  expect(submissions()).toHaveLength(0);
  for (const kind of ['Approve', 'Apply']) {
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${kind} the selected wallet link`) }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  }
  await view.findByText('The exact selected wallet is linked to this member.');
  await fireEvent.press(view.getByRole('button', { name: `Use company wallet approval ${APPROVAL}` }));
  for (const [label, value] of [
    ['Shares to grant', '1'],
    ['Terms dated on', '2020-01-01'],
    ['Non-paid grant terms', 'Outright non-paid grant'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Terms do not require recipient acceptance' }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose the terms document' }));
  await view.findByRole('button', { name: 'Replace the terms document' });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText('No issue execution admitted');
  expect((submissions()[0]![1] as RegisterIssuePreparation).member).toBe(ID(201));
  expect(get.mock.calls.map(([url]) => url)).not.toContain('/api/v1/wallets/');
});

it('shows actual original journal states and records a ledger date only from a genuine entered receipt', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText('No issue execution admitted');
  const record = issues[0]!;
  const execution = decided(
    { ...record, approvalDecision: ID(400) },
    {
      appointment: appointment.uuid,
      kind: 'apply',
      confirmation: true,
      idempotencyKey: ID(401),
      previewDigest: DIGEST,
    },
  ).execution!;
  issues = [{ ...record, status: 'applied', stage: 'applied', approvalDecision: ID(400), execution }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await view.findByText('Original issue admitted; execution queued');
  for (const [delta, label] of [
    [{ operationStatus: 'preparing' }, 'Original unsigned transaction preparing'],
    [{ operationStatus: 'signed', txHash: `0x${'7'.repeat(64)}` }, 'Original transaction signed; confirmation pending'],
    [{ operationStatus: 'confirmed' }, 'Chain receipt confirmed; finality and projection pending'],
    [{ status: 'executed' }, 'Finalised mint; register entry not recorded'],
    [
      { status: 'executed', issuance: ID(460), registerEntry: ID(461), effectiveOn: '2026-10-08' },
      'Finalised mint recorded in the register',
    ],
  ] as const) {
    issues = [{ ...issues[0]!, execution: { ...execution, ...delta } }];
    await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
    await view.findByText(label);
    if (label === 'Chain receipt confirmed; finality and projection pending') {
      failIssues = true;
      await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
      await waitFor(() => expect(client.isFetching()).toBe(0));
      await view.findByText('The grant records could not be refreshed. Retained original receipts remain available.');
      expect(view.getByText(label)).toBeTruthy();
      expect(view.queryByText('No issue execution admitted')).toBeNull();
      failIssues = false;
    }
  }
  expect(view.getByText('2026-10-08')).toBeTruthy();
  expect(view.getByText('2020-01-01')).toBeTruthy();
  expect(submissions()).toHaveLength(1);
});

it('shows director, expiry, imported-origin and headroom refusals and rejects a malformed preview without a new decision', async () => {
  const record = { ...prepared(), stage: 'approved', approvalDecision: ID(400) };
  issues = [record];
  let code = 'approving_director_conflict';
  const original = post.getMockImplementation()!;
  post.mockImplementation(async (url, body, config) => {
    executeGuards(config, body);
    if (url === URLS.REGISTER_ISSUE_PREVIEW(record.uuid))
      return {
        data: {
          ...preview(record, false),
          unmetRequirements: code === 'malformed' ? [] : [code],
          previewDigest: code === 'malformed' ? 'invalid' : DIGEST,
        },
      };
    return original(url, body, config);
  });
  const view = await open();
  for (const [refusal, message] of [
    ['approving_director_conflict', 'The named director is the recipient. Another director must approve this grant.'],
    ['wallet_approval_lapsed', 'The selected finite company wallet approval has expired.'],
    ['imported_register', 'Imported registers cannot issue on chain. Use the supported walletless grant workflow.'],
    ['insufficient_headroom', 'Available authorised headroom does not cover this grant and current reservations.'],
    ['malformed', 'The grant decision could not be previewed.'],
  ]) {
    code = refusal!;
    await fireEvent.press(view.getByRole('button', { name: /^Apply the company grant/ }));
    await view.findByText(message!);
    expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  }
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_ISSUE_DECIDE(record.uuid))).toHaveLength(0);
});

it('refuses all fresh evidence uploads when the selected finite ADD expires before the next form clock tick', async () => {
  const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 60000).toISOString();
  walletApprovals = [
    {
      ...approvedWallet,
      expiresAt,
      snapshot: { ...approvedWallet.snapshot, target: { ...approvedWallet.snapshot.target, expiresAt } },
    },
  ];
  const view = await open();
  await fill(view);
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt) + 1);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText(
    'Refresh genuine proof, finite approval and the exact linked member before this new grant decision.',
  );
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(0);
  expect(submissions()).toHaveLength(0);
  expect(view.getByLabelText('Non-paid grant terms').props.value).toBe(' Outright non-paid employee grant ');
  expect(view.queryByRole('button', { name: 'Recover company preparation receipt' })).toBeNull();
  now.mockRestore();
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText('No issue execution admitted');
  const uploads = post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE);
  expect(uploads).toHaveLength(3);
  expect(submissions()).toHaveLength(1);
  const lapsed = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt) + 1);
  for (const [, , config] of uploads) expect(() => config!.ledovaSubmissionGuard!()).toThrow('Refresh genuine proof');
  lapsed.mockRestore();
});

it('keeps a populated draft but sends no fresh evidence after the exact selected nomination refresh fails', async () => {
  const view = await open();
  await fill(view);
  failNominations = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await view.findByText('The selected company source records could not be refreshed. Refresh before a new decision.');
  expect(view.getByLabelText('Shares to grant').props.value).toBe('25');
  expect(view.getByRole('button', { name: 'Prepare company grant' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText('Refresh the exact retained company source before continuing.');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(0);
  expect(submissions()).toHaveLength(0);
  expect(view.getByLabelText('Non-paid grant terms').props.value).toBe(' Outright non-paid employee grant ');
  failNominations = false;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await waitFor(() =>
    expect(
      view.queryByText('The selected company source records could not be refreshed. Refresh before a new decision.'),
    ).toBeNull(),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Prepare company grant' }));
  await view.findByText('No issue execution admitted');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(submissions()).toHaveLength(1);
});

it('rechecks the actual selected LINK class source after native file acquisition before any fresh authority POST', async () => {
  links = [];
  members = [];
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: `Use nominated wallet ${ADDRESS}` }));
  await fireEvent.press(view.getByRole('button', { name: 'Use a new member' }));
  for (const [label, value] of [
    ['Approving director', 'Independent Director'],
    ['Company authority reference', 'LINK-1'],
    ['Reason for grant or wallet link', 'Document this exact nominated member'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  const classQuery = client
    .getQueryCache()
    .find({ queryKey: ['company-token', TOKEN], exact: false, predicate: (query) => query.queryKey.length === 5 })!;
  let changed = false;
  const info = nativeFileSystem.File.prototype.info;
  const acquire = jest.spyOn(nativeFileSystem.File.prototype, 'info').mockImplementation(function (
    this: InstanceType<typeof nativeFileSystem.File>,
  ) {
    const result = info.call(this);
    if (!changed && this.uri.includes('/ledova-upload-copies-v1/')) {
      changed = true;
      client.setQueryData(classQuery.queryKey, { ...classRecord, status: 'paused', statusDisplay: 'Paused' });
    }
    return result;
  });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare selected wallet link' }));
  await view.findByText('Refresh this deployed Base class before starting a new grant decision.');
  expect(changed).toBe(true);
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(0);
  expect(linkAnswer).not.toHaveBeenCalled();
  expect(view.getByLabelText('Company authority reference').props.value).toBe('LINK-1');
  acquire.mockRestore();
  await act(() => client.setQueryData(classQuery.queryKey, { ...classRecord }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Prepare selected wallet link' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Prepare selected wallet link' }));
  await view.findByText('Prepared wallet link');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
  expect(linkAnswer).toHaveBeenCalledTimes(1);
  expect(links[0]!.mapping).toEqual([{ address: ADDRESS, member: ID(201) }]);
});

it('retains the selected LINK draft but uploads no authority after the exact nomination refresh fails', async () => {
  links = [];
  members = [];
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: `Use nominated wallet ${ADDRESS}` }));
  await fireEvent.press(view.getByRole('button', { name: 'Use a new member' }));
  for (const [label, value] of [
    ['Approving director', 'Independent Director'],
    ['Company authority reference', 'LINK-REFRESH-1'],
    ['Reason for grant or wallet link', 'Document the exact selected member'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  failNominations = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await view.findByText('The selected company source records could not be refreshed. Refresh before a new decision.');
  await fireEvent.press(view.getByRole('button', { name: 'Prepare selected wallet link' }));
  await view.findByText('Refresh the exact retained company source before continuing.');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(0);
  expect(linkAnswer).not.toHaveBeenCalled();
  expect(view.getByLabelText('Company authority reference').props.value).toBe('LINK-REFRESH-1');
  expect(view.getByText(`Selected new member: ${ID(201)}`)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Recover company preparation receipt' })).toBeNull();
  failNominations = false;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await waitFor(() =>
    expect(
      view.queryByText('The selected company source records could not be refreshed. Refresh before a new decision.'),
    ).toBeNull(),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Prepare selected wallet link' }));
  await view.findByText('Prepared wallet link');
  const sent = post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE || url === URLS.REGISTER_LINKS);
  expect(sent.map(([url]) => url)).toEqual([URLS.REGISTER_EVIDENCE, URLS.REGISTER_LINKS]);
  expect(linkAnswer).toHaveBeenCalledTimes(1);
  expect(links[0]!.mapping).toEqual([{ address: ADDRESS, member: ID(201) }]);
  failNominations = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company grant records' }));
  await view.findByText('The selected company source records could not be refreshed. Refresh before a new decision.');
  for (const [, , config] of sent)
    expect(() => config!.ledovaSubmissionGuard!()).toThrow('Refresh the exact retained company source');
});
