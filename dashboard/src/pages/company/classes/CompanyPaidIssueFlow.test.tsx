// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  AUTH_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  type OwnCompanyAppointment,
  type RegisterPaidIssueSource,
  type RegisterPaidIssue,
  type RegisterPaidIssuePreparation,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyPaidIssueFlow } from './CompanyPaidIssueFlow';
import { useShareClass } from './useShareClass';

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

const page = (results: unknown[]) => ({ results, count: results.length, next: null, previous: null });
const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient;
let requests: InternalAxiosRequestConfig[];
let classRecord: typeof token;
let appointments: OwnCompanyAppointment[];
let records: RegisterPaidIssue[];
let sources: RegisterPaidIssueSource[];
let failSources: boolean;
let delayEvidence: boolean, replyEvidence: (() => void) | null;
let failClass: boolean, failHistory: boolean, losePrepare: boolean, loseApply: boolean, csrfAccountChange: boolean;
let prepareStatus: number, sequence: number;
let delayFile: boolean, replyFile: (() => void) | null;
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
function response(config: InternalAxiosRequestConfig, data: unknown) {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}
function refuse(config: InternalAxiosRequestConfig, status: number, data: unknown): never {
  throw new AxiosError('Synthetic request refused', 'ERR_BAD_RESPONSE', config, undefined, {
    ...response(config, data),
    status,
  });
}
function Subject({ uuid = TOKEN }: { uuid?: string }) {
  const data = useShareClass(uuid);
  return <CompanyPaidIssueFlow uuid={uuid} data={data} />;
}
function show() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <Subject />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}
async function fill() {
  await screen.findByRole('button', { name: 'Prepare paid issue' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  fireEvent.change(screen.getByLabelText('Recorded paid subscription'), { target: { value: paidSource.subscription } });
  fireEvent.change(screen.getByLabelText('Approving director'), { target: { value: ' Synthetic Director ' } });
  fireEvent.change(screen.getByLabelText('Paid issue reason'), {
    target: { value: ' Approve recorded paid allotment ' },
  });
  fireEvent.change(screen.getByLabelText('Authority reference'), { target: { value: ' BOARD-1 ' } });
  fireEvent.change(screen.getByLabelText('Paid issue authority document'), {
    target: { files: [new File(['authority'], 'authority.pdf', { type: 'application/pdf' })] },
  });
}
async function decide(kind: 'Approve' | 'Apply' | 'Reject', reason?: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${kind} \\(paid issue `) }));
  const dialog = await screen.findByRole('dialog');
  if (reason) {
    fireEvent.change(within(dialog).getByLabelText('Reason for rejection'), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview the rejection' }));
  }
  const confirm = await within(dialog).findByRole('button', { name: `${kind} paid issue` });
  await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
  fireEvent.click(confirm);
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile', userAccount: { uuid: 'account', role: 'investor' } },
  });
  classRecord = { ...token };
  appointments = [{ ...appointment }];
  records = [];
  sources = [structuredClone(paidSource)];
  failSources = false;
  delayEvidence = false;
  replyEvidence = null;
  requests = [];
  failClass = false;
  failHistory = false;
  losePrepare = false;
  loseApply = false;
  csrfAccountChange = false;
  prepareStatus = 0;
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
        return response(config, classRecord);
      }
      if (url === URLS.HOLDERS(TOKEN))
        return response(config, {
          token: classRecord,
          initialized: true,
          holders: [],
          issuedSupply: '10',
          waitingEffects: 0,
          totalHolders: 0,
          formerMembers: [],
        });
      if (url === APPOINTMENTS) return response(config, page(appointments));
      if (url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS) {
        if (failSources) return refuse(config, 503, {});
        return response(config, structuredClone(sources));
      }
      if (url === URLS.REGISTER_PAID_ISSUES) {
        if (failHistory) return refuse(config, 503, {});
        return response(config, page(records.map((row) => structuredClone(row))));
      }
      if (url === AUTH_ENDPOINTS.VERIFY) {
        if (csrfAccountChange)
          client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
            data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
          });
        return response(config, { valid: true });
      }
      if (url?.endsWith('/file/')) {
        if (delayFile)
          await new Promise<void>((resolve) => {
            replyFile = resolve;
          });
        return response(config, new Blob(['retained'], { type: 'application/pdf' }));
      }
      throw new Error(`Unexpected private GET ${url}`);
    }
    if (url === URLS.REGISTER_EVIDENCE) {
      const body = config.data as FormData;
      if (delayEvidence)
        await new Promise<void>((resolve) => {
          replyEvidence = resolve;
        });
      return response(config, {
        uuid: ID(2000 + ++sequence),
        company: body.get('company_id'),
        appointment: body.get('appointment'),
        kind: body.get('kind'),
        idempotencyKey: body.get('idempotency_key'),
        fileSize: (body.get('file') as File).size,
        sha256: DIGEST,
        providedBy: 'company',
      });
    }
    const body = JSON.parse(config.data as string);
    if (url === URLS.REGISTER_PAID_ISSUES) {
      if (csrfAccountChange) return refuse(config, 403, { detail: 'CSRF Failed: synthetic stale cookie' });
      if (prepareStatus === 400 || prepareStatus === 409) {
        const status = prepareStatus;
        prepareStatus = 0;
        return refuse(config, status, {});
      }
      const record = records.find((row) => row.uuid === body.operationId) ?? paidFrom(body);
      if (!records.some((row) => row.uuid === record.uuid)) records.push(record);
      if (prepareStatus) {
        const status = prepareStatus;
        prepareStatus = 0;
        return refuse(config, status, {});
      }
      if (losePrepare) {
        losePrepare = false;
        return refuse(config, 503, {});
      }
      return response(config, structuredClone(record));
    }
    const record = records.find(
      (row) => url === URLS.REGISTER_PAID_ISSUE_PREVIEW(row.uuid) || url === URLS.REGISTER_PAID_ISSUE_DECIDE(row.uuid),
    );
    if (record) {
      if (url === URLS.REGISTER_PAID_ISSUE_PREVIEW(record.uuid))
        return response(config, {
          previewDigest: DIGEST,
          unmetRequirements: [],
          canDecide: true,
          snapshot: record.snapshot,
          intentDigest: record.intentDigest,
          approvalDecision:
            body.kind === 'apply' ? (record.decisions.find((row) => row.kind === 'approve')?.uuid ?? null) : null,
          shares: record.shares,
          approvingDirector: record.approvingDirector,
          offeringHeadroom: '100',
          issuedSupply: '10',
          reservedShares: '0',
          authorisedSupply: '1000',
          availableShares: '990',
          reason: record.reason,
          authorityReference: record.authorityReference,
        });
      if (!record.decisions.some((row) => row.idempotencyKey === body.idempotencyKey)) {
        const decision = {
          uuid: ID(3000 + ++sequence),
          appointment: body.appointment,
          kind: body.kind,
          reason: body.reason ?? '',
          digest: body.previewDigest,
          idempotencyKey: body.idempotencyKey,
          decidedAt: '2026-10-08T00:00:00Z',
          decidedBy: 1,
          decidedByName: 'Synthetic Appointee',
        };
        record.decisions.push(decision);
        record.stage = body.kind === 'approve' ? 'approved' : body.kind === 'apply' ? 'applied' : 'rejected';
        if (body.kind !== 'approve') {
          record.status = body.kind === 'apply' ? 'applied' : 'rejected';
          record.reviewedAt = decision.decidedAt;
        }
        if (body.kind === 'apply') {
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
        if (body.kind === 'reject') record.rejectionReason = body.reason;
      }
      if (loseApply && body.kind === 'apply') {
        loseApply = false;
        return refuse(config, 503, {});
      }
      return response(config, structuredClone(record));
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

it('prepares and approves a recorded partial paid allotment without an issuance request, then admits only its original queued execution', async () => {
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByText('Prepared paid issue');
  const body = JSON.parse(
    requests.find((row) => row.url === URLS.REGISTER_PAID_ISSUES && row.method === 'post')!.data as string,
  );
  expect(body).toEqual({
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
  expect(records[0].snapshot.source.refundAmount).toBe('1.00');
  await decide('Approve');
  await screen.findByText('Approved paid issue');
  expect(records[0].request).toBeNull();
  expect(records[0].execution).toBeNull();
  await decide('Apply');
  await screen.findByText('Original paid issue admitted; execution queued');
  expect(records[0].execution?.request).toBe(records[0].request);
  expect(records[0].allottedAt).toBeNull();
  expect(
    requests.every(
      (row) =>
        !/wallet|nomination|eligibility|register-links|register-members|subscriptions\/.*allot/.test(row.url ?? ''),
    ),
  ).toBe(true);
  expect(screen.queryByText('Finalised original paid mint recorded in the register')).toBeNull();
});
it('loads no source selector or POST for a register reader, and permits private history download', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  show();
  await screen.findByText('Prepared paid issue');
  expect(screen.queryByRole('button', { name: 'Prepare paid issue' })).toBeNull();
  const create = vi.fn(() => 'blob:paid');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: /^Download paid issue authority/ }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(requests.every((row) => row.method === 'get' && row.url !== URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS)).toBe(
    true,
  );
});
it('uses narrow approve/apply appointments without preparer selector access, and retains rejection without financial cancellation', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  show();
  await screen.findByText('Prepared paid issue');
  expect(requests.some((row) => row.url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS)).toBe(false);
  await decide('Approve');
  await screen.findByText('Approved paid issue');
  appointments = [{ ...appointment, capabilities: ['apply'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByRole('button', { name: /^Apply \(paid issue / });
  await decide('Apply');
  await screen.findByText('Original paid issue admitted; execution queued');
  expect(requests.some((row) => row.url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS)).toBe(false);
  records.push({ ...prepared(), uuid: ID(123), operationId: ID(123) });
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByText('Prepared paid issue');
  await decide('Reject', 'Company refuses proposal');
  await screen.findByText('Rejected paid issue');
  expect(records[1].request).toBeNull();
  expect(records[1].subscriptionStatus).toBe('paid');
  expect(records[1].execution).toBeNull();
});
it('blocks fresh evidence after a populated source fails refresh and retries the retained draft against the healthy exact source', async () => {
  show();
  await fill();
  failSources = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByText(/Available paid subscription sources could not be refreshed/);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByText('Refresh the exact available paid subscription sources before continuing.');
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
  expect((screen.getByLabelText('Paid issue reason') as HTMLTextAreaElement).value).toBe(
    ' Approve recorded paid allotment ',
  );
  failSources = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByText('Prepared paid issue');
  expect(requests.filter((row) => row.method === 'post').map((row) => row.url)).toEqual([
    URLS.REGISTER_EVIDENCE,
    URLS.REGISTER_PAID_ISSUES,
  ]);
});
it('refuses source packet changes after awaited evidence upload before any preparation, then requires explicit current-source recapture', async () => {
  show();
  await fill();
  delayEvidence = true;
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await waitFor(() => expect(replyEvidence).not.toBeNull());
  sources[0].amountReceived = '17.00';
  sources[0].moneyHeld = '17.00';
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-paid-issue-sources'] });
  });
  await act(async () => {
    replyEvidence!();
  });
  await screen.findByText('The captured paid subscription source changed. Select its current recorded terms.');
  expect(requests.filter((row) => row.url === URLS.REGISTER_PAID_ISSUES && row.method === 'post')).toHaveLength(0);
  expect((screen.getByLabelText('Paid issue reason') as HTMLTextAreaElement).value).toBe(
    ' Approve recorded paid allotment ',
  );
  delayEvidence = false;
  fireEvent.click(screen.getByRole('button', { name: 'Use current recorded source' }));
  fireEvent.change(screen.getByLabelText('Paid issue authority document'), {
    target: { files: [new File(['authority'], 'authority.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByText('Prepared paid issue');
  expect(records[0].snapshot.source.amountReceived).toBe('17.00');
});
it('retains ambiguous original preparation body/key through class, history and selector loss and exact current-read replay', async () => {
  prepareStatus = 503;
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByRole('button', { name: 'Recover original paid issue preparation receipt' });
  const original = requests.find((row) => row.url === URLS.REGISTER_PAID_ISSUES && row.method === 'post')!.data;
  failClass = true;
  failHistory = true;
  failSources = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
    await client.refetchQueries({ queryKey: ['company-paid-issue-appointments'] });
    await client.refetchQueries({ queryKey: ['company-paid-issues'] });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Recover original paid issue preparation receipt' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Recover original paid issue preparation receipt' })).toBeNull(),
  );
  expect(
    requests.filter((row) => row.url === URLS.REGISTER_PAID_ISSUES && row.method === 'post').map((row) => row.data),
  ).toEqual([original, original]);
  expect(requests.filter((row) => row.url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
});
it('recovers consumed original apply body/key after source loss with one original execution and no replacement proposal', async () => {
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByText('Prepared paid issue');
  await decide('Approve');
  await screen.findByText('Approved paid issue');
  loseApply = true;
  await decide('Apply');
  await screen.findByRole('button', { name: 'Recover original decision receipt' });
  const original = requests.find(
    (row) =>
      row.url === URLS.REGISTER_PAID_ISSUE_DECIDE(records[0].uuid) && JSON.parse(row.data as string).kind === 'apply',
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
  fireEvent.click(screen.getByRole('button', { name: 'Recover original decision receipt' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    requests
      .filter((row) => row.url === original.url && JSON.parse(row.data as string).kind === 'apply')
      .map((row) => row.data),
  ).toEqual([original.data, original.data]);
  expect(records[0].decisions.filter((row) => row.kind === 'apply')).toHaveLength(1);
});
it('distinguishes actual allotment from Mint/register completion and retains the latest original receipt through failed history reads', async () => {
  records = [prepared()];
  show();
  await screen.findByText('Prepared paid issue');
  await decide('Approve');
  await screen.findByText('Approved paid issue');
  await decide('Apply');
  await screen.findByText('Original paid issue admitted; execution queued');
  records[0].subscriptionStatus = 'allotted';
  records[0].allottedAt = '2026-10-08T00:01:00Z';
  classRecord.totalSupply = '1007';
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByText('allotted');
  expect(screen.queryByText(/Finalised original paid mint/)).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByText('Finalised original paid mint; register entry not recorded');
  records[0].execution!.registerEntry = ID(154);
  records[0].execution!.effectiveOn = '2026-10-08';
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByText('Finalised original paid mint recorded in the register');
  failHistory = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await screen.findByText(
    'The paid issue records could not be refreshed. Retained original receipts remain available.',
  );
  expect(screen.getByText('Finalised original paid mint recorded in the register')).toBeTruthy();
});
it('refuses delayed CSRF redispatch and private-file save after an actual account change', async () => {
  csrfAccountChange = true;
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await waitFor(() => expect(requests.some((row) => row.url === AUTH_ENDPOINTS.VERIFY)).toBe(true));
  expect(requests.filter((row) => row.url === URLS.REGISTER_PAID_ISSUES && row.method === 'post')).toHaveLength(1);
});
it('saves no delayed private paid authority copy after the actual account changes', async () => {
  records = [prepared()];
  show();
  await screen.findByText('Prepared paid issue');
  delayFile = true;
  const create = vi.fn(() => 'blob:paid');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: /^Download paid issue authority/ }));
  await waitFor(() => expect(replyFile).not.toBeNull());
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
    });
    replyFile!();
  });
  expect(create).not.toHaveBeenCalled();
});
it('refuses expired authority and invalid input before new evidence while preserving the selected draft', async () => {
  show();
  await fill();
  fireEvent.change(screen.getByLabelText('Approving director'), { target: { value: 'x'.repeat(256) } });
  expect(screen.getByRole('button', { name: 'Prepare paid issue' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Approving director'), { target: { value: 'Synthetic Director' } });
  const now = Date.now();
  appointments[0].expiresAt = new Date(now + 1000).toISOString();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company paid issue records' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
});
it('keeps a mismatched preparation uncertain and recovers the exact original body without another source or upload', async () => {
  const adapter = apiClient.defaults.adapter as (config: InternalAxiosRequestConfig) => Promise<unknown>;
  let wrong = true;
  apiClient.defaults.adapter = async (config) => {
    const answer = (await adapter(config)) as ReturnType<typeof response>;
    if (wrong && config.method === 'post' && config.url === URLS.REGISTER_PAID_ISSUES) {
      wrong = false;
      return { ...answer, data: { ...(answer.data as object), approvingDirector: 'Other Director' } };
    }
    return answer;
  };
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original paid issue preparation receipt' }));
  await screen.findByText('Prepared paid issue');
  const bodies = requests
    .filter((row) => row.method === 'post' && row.url === URLS.REGISTER_PAID_ISSUES)
    .map((row) => row.data);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(records).toHaveLength(1);
  expect(requests.filter((row) => row.url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
});
it('keeps retained records and an unresolved original scoped to its class during direct same-company hook reuse', async () => {
  losePrepare = true;
  const view = show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare paid issue' }));
  await screen.findByRole('button', { name: 'Recover original paid issue preparation receipt' });
  const original = records[0],
    other = ID(999);
  const adapter = apiClient.defaults.adapter as (config: InternalAxiosRequestConfig) => Promise<unknown>;
  apiClient.defaults.adapter = async (config) => {
    if (config.method === 'get' && config.url === URLS.DETAIL(other))
      return response(config, { ...classRecord, uuid: other, contractAddress: `0x${'9'.repeat(40)}` });
    if (config.method === 'get' && config.url === URLS.HOLDERS(other))
      return response(config, {
        token: { ...classRecord, uuid: other },
        initialized: true,
        holders: [],
        issuedSupply: '0',
        waitingEffects: 0,
        totalHolders: 0,
        formerMembers: [],
      });
    if (config.method === 'get' && config.params?.token === other) {
      if (config.url === URLS.REGISTER_PAID_ISSUES) return response(config, page([]));
      if (config.url === URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS) return response(config, []);
    }
    return (await adapter(config)) as ReturnType<typeof response>;
  };
  view.rerender(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <Subject uuid={other} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('button', { name: 'Recover original paid issue preparation receipt' })).toBeNull();
  expect(screen.queryByText(original.uuid)).toBeNull();
  expect(screen.queryByText('Prepared paid issue')).toBeNull();
  expect(requests.filter((row) => row.url === URLS.REGISTER_PAID_ISSUES && row.method === 'post')).toHaveLength(1);
});
