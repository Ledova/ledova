// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  AUTH_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  type OwnCompanyAppointment,
  type RegisterIssue,
  type RegisterIssuePreparation,
  type RegisterIssueDecisionPreview,
  type RegisterLink,
  type RegisterLinkPreparation,
  type RegisterTransferMembers,
  type CompanyWalletInstruction,
  type CompanyWalletNomination,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { ShareClass } from './index';
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
const approvedWallet: CompanyWalletInstruction = {
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
};
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

const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient;
let requests: InternalAxiosRequestConfig[];
let appointments: OwnCompanyAppointment[];
let nominees: CompanyWalletNomination[];
let walletApprovals: CompanyWalletInstruction[];
let members: RegisterTransferMembers['members'];
let links: RegisterLink[];
let issues: RegisterIssue[];
let failClass: boolean;
let failHistory: boolean;
let failNominations: boolean;
let losePrepare: boolean;
let loseApply: boolean;
let prepareStatus: number;
let csrfAccountChange: boolean;
let sequence: number;
let delayFile: boolean;
let replyFile: (() => void) | null;
const page = (results: unknown[]) => ({ results, count: results.length, next: null, previous: null });
function linkFrom(body: RegisterLinkPreparation): RegisterLink {
  return {
    uuid: body.operationId,
    company: COMPANY,
    preparingAppointment: body.appointment,
    authorityEvidence: body.authorityEvidence,
    sourceDocument: null,
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
    typeof record.intentDigest !== 'string' ||
    typeof record.shares !== 'string' ||
    typeof record.termsOn !== 'string' ||
    typeof record.terms !== 'string' ||
    typeof record.acceptanceRequired !== 'boolean'
  )
    throw new Error('Synthetic company grant fixture is incomplete.');
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

function response(config: InternalAxiosRequestConfig, data: unknown) {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}
function refuse(config: InternalAxiosRequestConfig, status: number, data: unknown): never {
  throw new AxiosError('Synthetic request refused', 'ERR_BAD_RESPONSE', config, undefined, {
    ...response(config, data),
    status,
  });
}
function show() {
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <MemoryRouter>
          <ShareClass uuid={TOKEN} />
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}
async function fill() {
  await waitFor(() => expect(screen.getByLabelText('Nominated wallet').querySelectorAll('option').length).toBe(2));
  fireEvent.change(screen.getByLabelText('Nominated wallet'), { target: { value: NOMINATION } });
  fireEvent.change(screen.getByLabelText('Member'), { target: { value: MEMBER } });
  fireEvent.change(screen.getByLabelText('Company ADD'), { target: { value: APPROVAL } });
  fireEvent.change(screen.getByLabelText('Approving director'), { target: { value: 'Independent Director' } });
  fireEvent.change(screen.getByLabelText('Authority reference'), { target: { value: 'RES-1' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Employee grant' } });
  fireEvent.change(screen.getByLabelText('Shares to grant'), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Terms date'), { target: { value: '2020-01-01' } });
  fireEvent.change(screen.getByLabelText('Non-paid terms'), { target: { value: 'Outright non-paid employee grant' } });
  fireEvent.change(screen.getByLabelText('Authority document'), {
    target: { files: [new File(['authority'], 'authority.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByLabelText('Terms document'), {
    target: { files: [new File(['terms'], 'terms.pdf', { type: 'application/pdf' })] },
  });
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile', userAccount: { uuid: 'account', role: 'investor' } },
  });
  appointments = [{ ...appointment }];
  nominees = [{ ...nominee }];
  walletApprovals = [{ ...approvedWallet }];
  members = [{ ...member }];
  links = [
    {
      ...linkFrom({
        operationId: ID(140),
        appointment: appointment.uuid,
        companyId: COMPANY,
        authority: 'director_resolution',
        authorityReference: 'Existing link',
        approvingDirector: 'Independent Director',
        reason: 'Documentary link',
        authorityEvidence: ID(141),
        mapping: [{ address: ADDRESS, member: MEMBER }],
      }),
      status: 'applied',
      stage: 'applied',
    },
  ];
  issues = [];
  requests = [];
  failClass = false;
  failHistory = false;
  failNominations = false;
  losePrepare = false;
  loseApply = false;
  prepareStatus = 0;
  csrfAccountChange = false;
  sequence = 0;
  delayFile = false;
  replyFile = null;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => ID(1000 + ++sequence) as ReturnType<typeof crypto.randomUUID>,
  );
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    const url = config.url;
    if (config.method === 'get') {
      if (url === URLS.DETAIL(TOKEN)) {
        if (failClass) return refuse(config, 404, {});
        return response(config, token);
      }
      if (url === URLS.HOLDERS(TOKEN))
        return response(config, {
          token,
          initialized: true,
          holders: [],
          issuedSupply: '0',
          waitingEffects: 0,
          totalHolders: 0,
          formerMembers: [],
        });
      if (url === APPOINTMENTS) return response(config, page(appointments));
      if (url === NOMINATIONS) {
        if (failNominations) return refuse(config, 503, {});
        return response(config, page(nominees));
      }
      if (url === APPROVALS) return response(config, page(walletApprovals));
      if (url === URLS.REGISTER_MEMBERS(TOKEN)) return response(config, { members });
      if (url === URLS.REGISTER_LINKS) return response(config, page(links));
      if (url === URLS.REGISTER_ISSUES) {
        if (failHistory) return refuse(config, 404, {});
        return response(config, page(issues));
      }
      if (url === URLS.REGISTER_CAPITAL_INCREASES || url === URLS.REGISTER_DEPLOYMENTS)
        return response(config, page([]));
      if (url === AUTH_ENDPOINTS.VERIFY) {
        if (csrfAccountChange)
          client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
            data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
          });
        return response(config, { valid: true });
      }
      if (/\/(?:file|terms-file|acceptance-file)\/$/.test(url ?? '')) {
        if (delayFile)
          await new Promise<void>((resolve) => {
            replyFile = resolve;
          });
        return response(config, new Blob(['retained'], { type: 'application/pdf' }));
      }
      throw new Error(`Unexpected private GET ${url}`);
    }
    if (url === URLS.REGISTER_EVIDENCE) {
      const form = config.data as FormData;
      return response(config, {
        uuid: ID(2000 + ++sequence),
        company: form.get('company_id'),
        appointment: form.get('appointment'),
        kind: form.get('kind'),
        idempotencyKey: form.get('idempotency_key'),
        fileSize: (form.get('file') as File).size,
        sha256: DIGEST,
        providedBy: 'company',
      });
    }
    const body = JSON.parse(config.data as string);
    if (url === URLS.REGISTER_ISSUES) {
      if (csrfAccountChange) return refuse(config, 403, { detail: 'CSRF Failed: synthetic stale cookie' });
      if (prepareStatus) {
        const status = prepareStatus;
        prepareStatus = 0;
        return refuse(config, status, {});
      }
      const record = issues.find((row) => row.uuid === body.operationId) ?? issueFrom(body);
      if (!issues.some((row) => row.uuid === record.uuid)) issues.push(record);
      if (losePrepare) {
        losePrepare = false;
        return refuse(config, 503, {});
      }
      return response(config, record);
    }
    if (url === URLS.REGISTER_LINKS) {
      const record = links.find((row) => row.uuid === body.operationId) ?? linkFrom(body);
      if (!links.includes(record)) links.push(record);
      return response(config, record);
    }
    const issue = issues.find(
      (row) => url === URLS.REGISTER_ISSUE_PREVIEW(row.uuid) || url === URLS.REGISTER_ISSUE_DECIDE(row.uuid),
    );
    if (issue) {
      if (url === URLS.REGISTER_ISSUE_PREVIEW(issue.uuid))
        return response(config, {
          ...preview(issue),
          approvalDecision:
            body.kind === 'apply' ? (issue.decisions.find((row) => row.kind === 'approve')?.uuid ?? null) : null,
        });
      const prior = issue.decisions.find((row) => row.idempotencyKey === body.idempotencyKey);
      if (!prior) {
        const decision = {
          uuid: ID(3000 + ++sequence),
          appointment: body.appointment,
          kind: body.kind,
          reason: body.reason,
          digest: body.previewDigest,
          idempotencyKey: body.idempotencyKey,
          decidedAt: '2026-10-08T00:00:00Z',
          decidedBy: 1,
          decidedByName: 'Synthetic Appointee',
        };
        issue.decisions.push(decision);
        issue.stage = body.kind === 'approve' ? 'approved' : body.kind === 'apply' ? 'applied' : 'rejected';
        if (body.kind !== 'approve') {
          issue.status = body.kind === 'apply' ? 'applied' : 'rejected';
          issue.reviewedAt = decision.decidedAt;
        }
        if (body.kind === 'apply') {
          issue.approvalDecision = issue.decisions.find((row) => row.kind === 'approve')!.uuid;
          issue.execution = {
            execution: ID(150),
            request: ID(115),
            dispatchId: ID(151),
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
        if (body.kind === 'reject') issue.rejectionReason = body.reason;
      }
      if (loseApply && body.kind === 'apply') {
        loseApply = false;
        return refuse(config, 503, {});
      }
      return response(config, { ...issue, decisions: [...issue.decisions] });
    }
    const link = links.find(
      (row) => url === URLS.REGISTER_LINK_PREVIEW(row.uuid) || url === URLS.REGISTER_LINK_DECIDE(row.uuid),
    );
    if (link) {
      if (url === URLS.REGISTER_LINK_PREVIEW(link.uuid))
        return response(config, {
          previewDigest: DIGEST,
          unmetRequirements: [],
          canDecide: true,
          links: link.mapping.map((row) => ({
            ...row,
            memberExists: members.some((item) => item.member === row.member),
            walletProof: 'proven',
            holderType: 'member',
            holderName: 'Synthetic Employee',
          })),
        });
      const decision = {
        uuid: ID(4000 + ++sequence),
        appointment: body.appointment,
        kind: body.kind,
        reason: body.reason,
        digest: body.previewDigest,
        idempotencyKey: body.idempotencyKey,
        decidedAt: '2026-10-08T00:00:00Z',
        decidedBy: 1,
        decidedByName: 'Synthetic Appointee',
      };
      link.decisions.push(decision);
      link.stage = body.kind === 'approve' ? 'approved' : body.kind === 'apply' ? 'applied' : 'rejected';
      if (body.kind !== 'approve') {
        link.status = body.kind === 'apply' ? 'applied' : 'rejected';
        link.reviewedAt = decision.decidedAt;
      }
      if (body.kind === 'apply')
        members = [
          {
            ...member,
            member: link.mapping[0].member,
            name: null,
            residentialAddress: null,
            particularsRetained: false,
          },
        ];
      return response(config, { ...link, decisions: [...link.decisions] });
    }
    throw new Error(`Unexpected POST ${url}`);
  };
});
afterEach(async () => {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  cleanup();
  client.clear();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('prepares an exact non-paid existing-member grant with required evidence and no private owner/directory reads', async () => {
  show();
  await fill();
  fireEvent.click(screen.getByLabelText('Recipient acceptance required by these terms'));
  expect(screen.getByRole('button', { name: COPY_PREPARE })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Acceptance document'), {
    target: { files: [new File(['acceptance'], 'acceptance.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await screen.findByText('Prepared non-paid grant');
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    nomination: NOMINATION,
    walletApproval: APPROVAL,
    member: MEMBER,
    shares: '25',
    acceptanceRequired: true,
  });
  expect(issues[0].acceptanceEvidence).toBeTruthy();
  expect(requests.some((row) => /wallets|issuance-requests|issuances|company-eligibility/.test(row.url ?? ''))).toBe(
    false,
  );
  expect(screen.queryByText('Recipient address')).toBeNull();
  expect(screen.queryByText('Buy crypto')).toBeNull();
});
const COPY_PREPARE = 'Prepare non-paid grant';
it('keeps exact preparation body and operation after stage/source/class read loss and 403/404 ambiguity', async () => {
  losePrepare = true;
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await screen.findByRole('button', { name: 'Recover original preparation receipt' });
  const original = requests.find((row) => row.url === URLS.REGISTER_ISSUES && row.method === 'post')!.data;
  failClass = true;
  nominees = [];
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await waitFor(() => expect(screen.queryByLabelText('Shares to grant')).toBeNull());
  for (const status of [403, 404, 0]) {
    prepareStatus = status;
    fireEvent.click(await screen.findByRole('button', { name: 'Recover original preparation receipt' }));
    if (status)
      await waitFor(() =>
        expect(requests.filter((row) => row.url === URLS.REGISTER_ISSUES && row.method === 'post').length).toBe(
          status === 403 ? 2 : 3,
        ),
      );
  }
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Recover original preparation receipt' })).toBeNull(),
  );
  expect(
    requests.filter((row) => row.url === URLS.REGISTER_ISSUES && row.method === 'post').map((row) => row.data),
  ).toEqual([original, original, original, original]);
});
it('permits read-register facts with no preparation or decisions and no POST', async () => {
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  issues = [prepared()];
  show();
  await screen.findByText('Prepared non-paid grant');
  expect(screen.queryByLabelText('Shares to grant')).toBeNull();
  expect(screen.queryByRole('button', { name: /Approve non-paid/ })).toBeNull();
  expect(requests.every((row) => row.method === 'get')).toBe(true);
});
it('refuses a delayed CSRF redispatch after the actual account changes', async () => {
  csrfAccountChange = true;
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await waitFor(() => expect(requests.some((row) => row.url === AUTH_ENDPOINTS.VERIFY)).toBe(true));
  await waitFor(() => expect(screen.queryByLabelText('Shares to grant')).toBeNull());
  expect(requests.filter((row) => row.url === URLS.REGISTER_ISSUES && row.method === 'post')).toHaveLength(1);
});
it('retains actual latest admitted journal state across refresh then failed history without optimistic shares', async () => {
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await screen.findByText('Prepared non-paid grant');
  const issue = issues[0];
  issue.status = 'applied';
  issue.stage = 'applied';
  issue.approvalDecision = ID(160);
  issue.execution = {
    execution: ID(150),
    request: ID(115),
    dispatchId: ID(151),
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
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await screen.findByText('Original issue admitted; execution queued');
  if (!issue.execution) throw new Error('Synthetic applied execution is missing.');
  issue.execution = {
    ...issue.execution,
    status: 'executed',
    issuance: ID(161),
    operationStatus: 'confirmed',
    operationId: ID(162),
    claimId: ID(163),
    transaction: ID(164),
    txHash: '0x' + 'a'.repeat(64),
    blockNumber: 3,
    blockHash: '0x' + 'b'.repeat(64),
    completedAt: '2026-10-08T00:00:00Z',
    registerEntry: ID(165),
    effectiveOn: '2026-10-08',
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await screen.findByText('Finalised mint recorded in the register');
  failHistory = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await screen.findByText(
    'Current grant sources or history could not be refreshed. Retained original receipts are kept.',
  );
  expect(screen.getByText('Finalised mint recorded in the register')).toBeTruthy();
});

async function decide(kind: 'Approve' | 'Apply' | 'Reject', noun: 'grant' | 'link', reason?: string) {
  const title = `${kind} ${noun === 'grant' ? 'non-paid grant' : 'wallet link'}`;
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${kind} \\(${noun} `) }));
  const dialog = await screen.findByRole('dialog');
  if (reason) {
    fireEvent.change(within(dialog).getByLabelText('Reason for rejection'), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview the rejection' }));
  }
  const confirm = await within(dialog).findByRole('button', { name: title });
  await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
  fireEvent.click(confirm);
}

it('documents the exact nominated wallet against a new zero member before preparing its grant', async () => {
  members = [];
  links = [];
  show();
  await fill();
  fireEvent.change(screen.getByLabelText('Member'), { target: { value: 'new' } });
  expect(screen.getByRole('button', { name: COPY_PREPARE })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare nominated wallet link' }));
  await screen.findByText('Prepared wallet link');
  const stableMember = links[0].mapping[0].member;
  expect(links[0].mapping).toEqual([{ address: ADDRESS, member: stableMember }]);
  expect(members).toHaveLength(0);
  await decide('Approve', 'link');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await decide('Apply', 'link');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect((screen.getByLabelText('Member') as HTMLSelectElement).value).toBe(stableMember));
  expect(members).toEqual([
    expect.objectContaining({
      member: stableMember,
      currentShares: '0',
      name: null,
      particularsRetained: false,
      walletless: false,
    }),
  ]);
  expect((screen.getByLabelText('Non-paid terms') as HTMLTextAreaElement).value).toBe(
    'Outright non-paid employee grant',
  );
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await screen.findByText('Prepared non-paid grant');
  expect(issues[0]).toMatchObject({
    member: stableMember,
    nomination: NOMINATION,
    walletApproval: APPROVAL,
    shares: '25',
  });
  expect(requests.filter((row) => row.url === URLS.REGISTER_EVIDENCE && row.method === 'post')).toHaveLength(2);
  expect(requests.some((row) => /wallets|company-eligibility|register\/waiting/.test(row.url ?? ''))).toBe(false);
});

it('recovers the original apply body after admission and source loss using current read-register access', async () => {
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await screen.findByText('Prepared non-paid grant');
  await decide('Approve', 'grant');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  loseApply = true;
  await decide('Apply', 'grant');
  await screen.findByRole('button', { name: 'Recover original decision receipt' });
  const uuid = issues[0].uuid;
  const original = requests.find(
    (row) => row.url === URLS.REGISTER_ISSUE_DECIDE(uuid) && JSON.parse(row.data as string).kind === 'apply',
  )!;
  nominees = [];
  walletApprovals = [];
  failClass = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await screen.findByText('Original issue admitted; execution queued');
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original decision receipt' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const retries = requests.filter(
    (row) => row.url === URLS.REGISTER_ISSUE_DECIDE(uuid) && JSON.parse(row.data as string).kind === 'apply',
  );
  expect(retries.map((row) => row.data)).toEqual([original.data, original.data]);
  expect(issues[0].decisions.filter((row) => row.kind === 'apply')).toHaveLength(1);
  expect(issues[0].execution?.registerEntry).toBeNull();
  expect(screen.queryByText('Finalised mint recorded in the register')).toBeNull();
});

it('offers only the current narrow step, retaining refusal and real rejection history', async () => {
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  issues = [prepared()];
  show();
  await screen.findByText('Prepared non-paid grant');
  expect(screen.queryByLabelText('Shares to grant')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Apply \(grant/ })).toBeNull();
  await decide('Reject', 'grant', 'Company withdrew these terms');
  await screen.findByText('Rejected non-paid grant');
  expect(issues[0]).toMatchObject({
    status: 'rejected',
    rejectionReason: 'Company withdrew these terms',
    execution: null,
  });
  expect(
    requests
      .filter((row) => row.method === 'post')
      .every(
        (row) =>
          row.url === URLS.REGISTER_ISSUE_PREVIEW(issues[0].uuid) ||
          row.url === URLS.REGISTER_ISSUE_DECIDE(issues[0].uuid),
      ),
  ).toBe(true);
});

it.each(['2147483646', '2147483647', '2147483648'])(
  'keeps share request %s exact within the maintained bound',
  async (amount) => {
    show();
    await fill();
    fireEvent.change(screen.getByLabelText('Shares to grant'), { target: { value: amount } });
    const submit = screen.getByRole('button', { name: COPY_PREPARE });
    expect(submit).toHaveProperty('disabled', amount === '2147483648');
    fireEvent.click(submit);
    if (amount === '2147483648') expect(requests.every((row) => row.method === 'get')).toBe(true);
    else {
      await screen.findByText('Prepared non-paid grant');
      expect(issues[0].shares).toBe(amount);
    }
  },
);

it('downloads exact retained copies under current read access and refuses saving a late copy after account change', async () => {
  const create = vi.fn(() => 'blob:grant');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  issues = [prepared()];
  show();
  await screen.findByText('Prepared non-paid grant');
  for (const kind of ['authority', 'terms', 'acceptance']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Download ${kind} document`) }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(kind === 'authority' ? 1 : kind === 'terms' ? 2 : 3));
  }
  expect(
    requests.filter((row) => /\/(?:file|terms-file|acceptance-file)\/$/.test(row.url ?? '')).map((row) => row.url),
  ).toEqual([
    URLS.REGISTER_ISSUE_FILE(issues[0].uuid),
    URLS.REGISTER_ISSUE_TERMS_FILE(issues[0].uuid),
    URLS.REGISTER_ISSUE_ACCEPTANCE_FILE(issues[0].uuid),
  ]);
  delayFile = true;
  fireEvent.click(screen.getByRole('button', { name: /^Download terms document/ }));
  await waitFor(() => expect(replyFile).not.toBeNull());
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
    }),
  );
  await act(async () => replyFile!());
  expect(save).toHaveBeenCalledTimes(3);
  expect(create).toHaveBeenCalledTimes(3);
  expect(revoke).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('Outright non-paid employee grant')).toBeNull();
});

it('refuses fresh grant evidence dispatch after its selected nomination source expires while retaining the draft', async () => {
  show();
  await fill();
  nominees = [{ ...nominee, eligibilityExpiresAt: '2020-01-01T00:00:00Z', unmetRequirements: ['eligibility_lapsed'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  fireEvent.click(screen.getByRole('button', { name: COPY_PREPARE }));
  await screen.findByText(
    'Refresh genuine proof, finite approval and the exact linked member before this new grant decision.',
  );
  expect((screen.getByLabelText('Non-paid terms') as HTMLTextAreaElement).value).toBe(
    'Outright non-paid employee grant',
  );
  expect(requests.every((row) => row.method === 'get')).toBe(true);
});

it('retains the selected LINK draft but uploads no authority after the exact nomination refresh fails', async () => {
  links = [];
  members = [];
  show();
  await waitFor(() => expect(screen.getByLabelText('Nominated wallet').querySelectorAll('option').length).toBe(2));
  fireEvent.change(screen.getByLabelText('Nominated wallet'), { target: { value: NOMINATION } });
  const selected = screen.getByText(/New stable member:/).textContent;
  for (const [label, value] of [
    ['Approving director', 'Independent Director'],
    ['Authority reference', 'LINK-REFRESH-1'],
    ['Reason', 'Document the exact selected member'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText('Authority document'), {
    target: { files: [new File(['authority'], 'authority.pdf', { type: 'application/pdf' })] },
  });
  failNominations = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await screen.findByText(
    'Current grant sources or history could not be refreshed. Retained original receipts are kept.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prepare nominated wallet link' }));
  await screen.findByText('Refresh the exact retained company source before continuing.');
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
  expect((screen.getByLabelText('Authority reference') as HTMLInputElement).value).toBe('LINK-REFRESH-1');
  expect(screen.getByText(/New stable member:/).textContent).toBe(selected);
  expect(screen.queryByRole('button', { name: 'Recover original preparation receipt' })).toBeNull();
  failNominations = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await waitFor(() =>
    expect(
      screen.queryByText(
        'Current grant sources or history could not be refreshed. Retained original receipts are kept.',
      ),
    ).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prepare nominated wallet link' }));
  await screen.findByText('Prepared wallet link');
  const sent = requests.filter((row) => row.method === 'post');
  expect(sent.map((row) => row.url)).toEqual([URLS.REGISTER_EVIDENCE, URLS.REGISTER_LINKS]);
  expect(links[0].mapping).toEqual([{ address: ADDRESS, member: selected!.replace('New stable member: ', '') }]);
  failNominations = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company grant records' }));
  await screen.findByText(
    'Current grant sources or history could not be refreshed. Retained original receipts are kept.',
  );
  for (const config of sent)
    expect(() => config.ledovaSubmissionGuard!()).toThrow('Refresh the exact retained company source');
});
