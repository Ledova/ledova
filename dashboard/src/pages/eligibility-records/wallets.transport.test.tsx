// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  AUTH_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyEligibilityRequest,
  type OwnCompanyAppointment,
  type Wallet,
  type WalletNomination,
  type WalletNominationPreview,
  type CompanyWalletNomination,
  type CompanyWalletInstruction,
  type CompanyWalletTarget,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import ParticipantEligibilityPage from './participant';
import CompanyEligibilityPage from './company';
const uuid = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const account = uuid(1),
  company = uuid(2),
  otherCompany = uuid(3),
  requestId = uuid(4),
  appointmentId = uuid(5),
  walletId = uuid(6),
  otherWalletId = uuid(7);
const digest = 'a'.repeat(64),
  expiry = '2027-01-05T12:00:00.000Z',
  timestamp = '2026-10-07T00:00:00Z';
const ownRequestsUrl = '/api/v1/company-eligibility/requests/',
  ownUrl = '/api/v1/whitelist/wallet-nominations/',
  nominatedUrl = '/api/v1/whitelist/company-wallet-nominations/',
  instructionsUrl = '/api/v1/whitelist/company-wallet-instructions/',
  targetsUrl = '/api/v1/whitelist/company-wallet-targets/';
const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient,
  sent: InternalAxiosRequestConfig[],
  requests: CompanyEligibilityRequest[],
  wallets: Wallet[],
  nominations: WalletNomination[],
  instructions: CompanyWalletInstruction[],
  targets: CompanyWalletTarget[],
  appointments: OwnCompanyAppointment[];
let hasProof: boolean,
  loseNomination: boolean,
  losePreparation: boolean,
  loseApply: boolean,
  sourceLost: boolean,
  sequence: number;

function request(id = requestId, target = company): CompanyEligibilityRequest {
  return {
    uuid: id,
    company: target,
    userAccount: account,
    source: uuid(10),
    category: 'professional_investor',
    sharedSummary: {
      category: 'professional_investor',
      source: uuid(10),
      company: target,
      userAccount: account,
      declarationText: 'Synthetic declaration',
      submittedAt: timestamp,
      requestedExpiresAt: expiry,
    },
    digest,
    evidenceHash: digest,
    sourceFingerprint: digest,
    idempotencyKey: uuid(11),
    version: '1',
    outcome: 'accepted',
    requestedExpiresAt: expiry,
    submittedAt: timestamp,
    submittedBy: 1,
    withdrawal: null,
    decision: {
      uuid: uuid(12),
      appointment: appointmentId,
      decidedAt: timestamp,
      decidedBy: 2,
      digest,
      requestDigest: digest,
      expiresAt: expiry,
      idempotencyKey: uuid(13),
      outcome: 'accepted',
      reason: '',
      revocation: null,
    },
  };
}
function wallet(id: string, letter: string): Wallet {
  return {
    uuid: id,
    userAccount: account,
    address: '0x' + letter.repeat(40),
    chain: 'base',
    name: `PRIVATE wallet ${letter}`,
    signingPreference: 'hardware',
    derivationPath: "m/44'/60'/0'/0/0",
    masterFingerprint: 'aabbccdd',
    verificationStatus: 'VERIFIED',
    verificationChallenge: 'PRIVATE challenge',
    verificationSignature: 'PRIVATE signature',
    verifiedAt: timestamp,
    lastSyncedAt: null,
    nativeBalance: '1234',
    nativeMarketValue: '1234',
    marketValue: '1234',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
function appointment(capabilities: OwnCompanyAppointment['capabilities']): OwnCompanyAppointment {
  return {
    uuid: appointmentId,
    company,
    companyName: 'Company A',
    source: 'invitation',
    capabilities,
    delegatableCapabilities: [],
    status: 'active',
    isEffective: true,
    expiresAt: null,
    revokedAt: null,
    createdAt: timestamp,
    declarationText: 'Synthetic appointment',
    declarationVersion: '2026-10-04',
  };
}
function preview(input: Record<string, unknown>): WalletNominationPreview {
  const selectedRequest = requests.find((row) => row.uuid === input.request)!,
    selectedWallet = wallets.find((row) => row.uuid === input.wallet)!;
  return {
    request: selectedRequest.uuid,
    decision: selectedRequest.decision!.uuid,
    company: selectedRequest.company,
    wallet: selectedWallet.uuid,
    address: selectedWallet.address,
    chain: 'base',
    proof: hasProof ? uuid(14) : null,
    proofCompletedAt: hasProof ? timestamp : null,
    eligibilityExpiresAt: expiry,
    previewDigest: digest,
    canSubmit: hasProof && !sourceLost,
    unmetRequirements: [
      ...(hasProof ? [] : ['wallet_proof_required']),
      ...(sourceLost ? ['eligibility_source_lapsed'] : []),
    ],
  };
}
function nominated(row: WalletNomination): CompanyWalletNomination {
  return {
    uuid: row.uuid,
    request: row.request,
    decision: row.decision,
    company: row.company,
    address: row.address,
    chain: row.chain,
    proofCompletedAt: row.proofCompletedAt,
    eligibilityExpiresAt: row.eligibilityExpiresAt,
    digest: row.digest,
    submittedAt: row.submittedAt,
    unmetRequirements: sourceLost ? ['wallet_source_changed'] : [],
  };
}
function provenNomination(input: Record<string, unknown>, id: string): WalletNomination {
  const value = preview(input);
  if (!value.decision || !value.proof || !value.proofCompletedAt || !value.eligibilityExpiresAt)
    throw new Error('Fixture requires genuine proof and an accepted eligibility decision');
  return {
    uuid: id,
    operationId: id,
    request: value.request,
    company: value.company,
    wallet: value.wallet,
    address: value.address,
    chain: value.chain,
    decision: value.decision,
    proof: value.proof,
    proofCompletedAt: value.proofCompletedAt,
    eligibilityExpiresAt: value.eligibilityExpiresAt,
    digest: value.previewDigest,
    sharingAccepted: true,
    submittedAt: timestamp,
    unmetRequirements: [],
  };
}
function prepare(input: Record<string, unknown>): CompanyWalletInstruction {
  const nomination = nominations.find((row) => row.uuid === input.nomination),
    target = targets.find((row) => row.uuid === input.targetChange);
  const expiresAt = input.action === 'add' ? String(input.expiresAt) : null;
  return {
    uuid: String(input.operationId),
    operationId: String(input.operationId),
    company: String(input.company),
    action: input.action as CompanyWalletInstruction['action'],
    nomination: nomination?.uuid ?? null,
    targetChange: target?.uuid ?? null,
    expiresAt,
    intentDigest: digest,
    preparingAppointment: String(input.appointment),
    preparedByName: 'Synthetic Administrator',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    approvalDecision: null,
    changeId: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: timestamp,
    execution: null,
    executionUnmetRequirements: [],
    snapshot: {
      company: { uuid: company, name: 'Company A', acn: '123456789', status: 'active' },
      target: {
        address: nomination?.address ?? target!.address,
        chain: 'base',
        chainId: 84532,
        registryAddress: '0x' + 'c'.repeat(40),
        expiresAt,
      },
      source: {
        nomination: nomination?.uuid ?? null,
        request: nomination?.request ?? null,
        decision: nomination?.decision ?? null,
        proofCompletedAt: nomination?.proofCompletedAt ?? null,
        eligibilityExpiresAt: nomination?.eligibilityExpiresAt ?? null,
        targetChange: target?.uuid ?? null,
      },
      transaction: {
        chainId: 84532,
        sender: '0x' + 'd'.repeat(40),
        to: '0x' + 'c'.repeat(40),
        value: '0',
        data: '0x1234',
      },
    },
  };
}
const response = (config: InternalAxiosRequestConfig, data: unknown) => ({
  config,
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
});
const list = (config: InternalAxiosRequestConfig, rows: unknown[]) =>
  response(config, { count: rows.length, next: null, results: rows });
const posts = (url: string) => sent.filter((config) => config.method === 'post' && config.url === url);
const body = (config: InternalAxiosRequestConfig) => JSON.parse(String(config.data)) as Record<string, unknown>;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: uuid(50), userAccount: { uuid: account, role: 'investor' } },
  });
  requests = [request(), request(uuid(40), otherCompany)];
  wallets = [wallet(walletId, 'a'), wallet(otherWalletId, 'b')];
  nominations = [];
  instructions = [];
  targets = [];
  appointments = [appointment(['admin'])];
  hasProof = true;
  loseNomination = false;
  losePreparation = false;
  loseApply = false;
  sourceLost = false;
  sequence = 100;
  sent = [];
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => uuid(++sequence) as ReturnType<Crypto['randomUUID']>);
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    if (config.method === 'get') {
      if (config.url === '/api/investor-classifications/') return list(config, []);
      if (config.url === '/api/v1/company-authority/appointments/') return list(config, appointments);
      if (config.url === ownRequestsUrl) return list(config, requests);
      if (config.url?.startsWith(ownRequestsUrl))
        return response(
          config,
          requests.find((row) => config.url === `${ownRequestsUrl}${row.uuid}/`),
        );
      if (config.url === '/api/wallets/') return list(config, wallets);
      if (config.url === ownUrl)
        return list(
          config,
          nominations.filter((row) => row.request === config.params.request),
        );
      if (config.url === nominatedUrl)
        return list(config, nominations.filter((row) => row.company === config.params.company).map(nominated));
      if (config.url === targetsUrl)
        return list(
          config,
          targets.filter((row) => row.company === config.params.company),
        );
      if (config.url === instructionsUrl)
        return list(
          config,
          instructions.filter((row) => row.company === config.params.company),
        );
      throw new Error(`Unexpected wallet read ${config.url}`);
    }
    const input = body(config);
    if (config.url === `${ownUrl}preview/`) return response(config, preview(input));
    if (config.url === ownUrl) {
      const retained = nominations.find((row) => row.uuid === input.operationId);
      const record = retained ?? provenNomination(input, String(input.operationId));
      if (!retained) nominations.push(record);
      if (loseNomination) {
        loseNomination = false;
        throw new AxiosError('Synthetic lost nomination', AxiosError.ERR_NETWORK, config);
      }
      return response(config, record);
    }
    if (config.url === instructionsUrl) {
      const retained = instructions.find((row) => row.uuid === input.operationId),
        record = retained ?? prepare(input);
      if (!retained) instructions.push(record);
      if (losePreparation) {
        losePreparation = false;
        throw new AxiosError('Synthetic lost preparation', AxiosError.ERR_NETWORK, config);
      }
      return response(config, record);
    }
    const record = instructions.find((row) => config.url?.startsWith(`${instructionsUrl}${row.uuid}/`));
    if (record && config.url?.endsWith('/decision-preview/'))
      return response(config, {
        snapshot: record.snapshot,
        intentDigest: record.intentDigest,
        previewDigest: digest,
        approvalDecision:
          input.kind === 'apply'
            ? (record.decisions.find((row) => row.kind === 'approve')?.uuid ?? null)
            : record.approvalDecision,
        changeId: record.changeId,
        canDecide: true,
        unmetRequirements: [],
      });
    if (record && config.url?.endsWith('/decide/')) {
      if (!record.decisions.some((row) => row.idempotencyKey === input.idempotencyKey)) {
        const decision = {
          uuid: uuid(++sequence),
          kind: input.kind,
          appointment: input.appointment,
          reason: input.reason ?? '',
          digest,
          idempotencyKey: input.idempotencyKey,
          decidedAt: timestamp,
          decidedBy: 1,
          decidedByName: 'Synthetic Administrator',
        } as CompanyWalletInstruction['decisions'][number];
        record.decisions.push(decision);
        if (input.kind === 'approve') record.stage = 'approved';
        if (input.kind === 'apply') {
          record.approvalDecision = record.decisions.find((row) => row.kind === 'approve')!.uuid;
          record.status = 'applied';
          record.stage = 'applied';
          record.changeId = uuid(200);
          record.reviewedAt = timestamp;
          record.execution = {
            change: record.changeId,
            status: 'executing',
            operationId: uuid(201),
            claimId: uuid(202),
            operationStatus: 'signed',
            txHash: '0x' + 'e'.repeat(64),
            transaction: null,
            blockNumber: null,
            blockHash: null,
            completedAt: null,
            failureCode: '',
          };
        }
      }
      if (input.kind === 'apply' && loseApply) {
        loseApply = false;
        throw new AxiosError('Synthetic lost apply', AxiosError.ERR_NETWORK, config);
      }
      return response(config, record);
    }
    throw new Error(`Unexpected wallet write ${config.url}`);
  };
});

afterEach(() => {
  cleanup();
  client.clear();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});
function show(children: React.ReactNode) {
  return render(
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </ApiClientProvider>,
  );
}
async function participant() {
  show(<ParticipantEligibilityPage />);
  fireEvent.click(await screen.findByRole('button', { name: `View request ${requestId}` }));
  await screen.findByRole('combobox', { name: 'Nomination wallet' });
  await waitFor(() =>
    expect(
      within(screen.getByRole('combobox', { name: 'Nomination wallet' })).getByRole('option', {
        name: new RegExp(wallets[0].address),
      }),
    ).toBeTruthy(),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Nomination wallet' }), { target: { value: walletId } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Review wallet nomination' }).hasAttribute('disabled')).toBe(false),
  );
}
async function nominate() {
  fireEvent.click(screen.getByRole('button', { name: 'Review wallet nomination' }));
  const consent = await screen.findByRole('checkbox', { name: 'Share this selected address with this exact company.' });
  fireEvent.click(consent);
  fireEvent.click(screen.getByRole('button', { name: 'Submit wallet nomination' }));
  await waitFor(() => expect(nominations).toHaveLength(1));
}
async function companyView() {
  show(<CompanyEligibilityPage />);
  const select = await screen.findByRole('combobox', { name: 'Wallet approval company' });
  await waitFor(() => expect(within(select).getByRole('option', { name: `Company A · ${company}` })).toBeTruthy());
  fireEvent.change(select, { target: { value: company } });
  await waitFor(() => expect(sent.some((config) => config.url === instructionsUrl)).toBe(true));
}
function seedNomination() {
  nominations = [provenNomination({ request: requestId, wallet: walletId }, uuid(60))];
}
async function prepareAdd() {
  const target = await screen.findByRole('combobox', { name: 'Wallet instruction target' });
  await waitFor(() =>
    expect(within(target).getByRole('option', { name: new RegExp(nominations[0].uuid) })).toBeTruthy(),
  );
  fireEvent.change(target, { target: { value: nominations[0].uuid } });
  fireEvent.change(screen.getByLabelText('Wallet approval expiry'), { target: { value: '2027-01-05T12:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare wallet instruction' }));
  await waitFor(() => expect(instructions).toHaveLength(1));
}
async function decision(kind: 'Approve' | 'Apply' | 'Reject') {
  fireEvent.click(await screen.findByRole('button', { name: `${kind} wallet instruction` }));
  const dialog = await screen.findByRole('dialog', { name: `${kind} wallet instruction` });
  await waitFor(() =>
    expect(
      within(dialog)
        .getByRole('button', { name: `${kind} wallet instruction` })
        .hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: `${kind} wallet instruction` }));
}
it('requires separate address sharing and exposes only one nominated wallet to its company', async () => {
  await participant();
  fireEvent.click(screen.getByRole('button', { name: 'Review wallet nomination' }));
  await screen.findByRole('checkbox', { name: 'Share this selected address with this exact company.' });
  expect(screen.getByRole('button', { name: 'Submit wallet nomination' }).hasAttribute('disabled')).toBe(true);
  expect(posts(ownUrl)).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Share this selected address with this exact company.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit wallet nomination' }));
  await waitFor(() => expect(nominations).toHaveLength(1));
  expect(body(posts(ownUrl)[0])).toEqual({
    operationId: nominations[0].uuid,
    request: requestId,
    wallet: walletId,
    previewDigest: digest,
    sharingAccepted: true,
  });
  cleanup();
  sent = [];
  await companyView();
  const target = await screen.findByRole('combobox', { name: 'Wallet instruction target' });
  await waitFor(() =>
    expect(within(target).getByRole('option', { name: new RegExp(nominations[0].uuid) })).toBeTruthy(),
  );
  expect(screen.queryByText(wallets[1].address)).toBeNull();
  expect(screen.queryByText(/PRIVATE wallet|PRIVATE signature|PRIVATE challenge/)).toBeNull();
  expect(sent.some((config) => config.url === '/api/wallets/' || config.url?.includes('/eligibility-requests/'))).toBe(
    false,
  );
  expect(nominations.every((record) => record.company === company)).toBe(true);
});
it('reuses the verification modal to refresh a VERIFIED wallet whose genuine proof is absent', async () => {
  hasProof = false;
  await participant();
  fireEvent.click(screen.getByRole('button', { name: 'Review wallet nomination' }));
  await screen.findByText('Refresh ordinary possession proof for this exact wallet.');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Share this selected address with this exact company.' }));
  expect(screen.getByRole('button', { name: 'Submit wallet nomination' }).hasAttribute('disabled')).toBe(true);
  expect(posts(ownUrl)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh selected wallet possession proof' }));
  const dialog = await screen.findByRole('dialog', { name: 'Verify Wallet' });
  expect(within(dialog).getByRole('button', { name: 'Sign with a seed phrase' })).toBeTruthy();
});
it('recovers the complete original nomination after source loss and an unavailable source read', async () => {
  loseNomination = true;
  await participant();
  await nominate();
  await screen.findByRole('button', { name: 'Recover original nomination' });
  const original = body(posts(ownUrl)[0]);
  sourceLost = true;
  const key = ['eligibility-records', 'participant', uuid(50), account, 0, '', requestId];
  act(() =>
    client
      .getQueryCache()
      .find({ queryKey: key, exact: true })!
      .setState({ status: 'error', error: new Error('Synthetic source unavailable') }),
  );
  expect(screen.getByRole('button', { name: 'Recover original nomination' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Recover original nomination' }));
  await waitFor(() => expect(posts(ownUrl)).toHaveLength(2));
  expect(body(posts(ownUrl)[1])).toEqual(original);
  expect(nominations).toHaveLength(1);
});
it.each(['admin', 'apply'] as const)(
  'lets current %s appointees read only the minimal wallet section without the old private eligibility queue',
  async (capability) => {
    appointments = [appointment([capability])];
    seedNomination();
    await companyView();
    const select = await screen.findByRole('combobox', { name: 'Wallet instruction target' });
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: new RegExp(nominations[0].uuid) })).toBeTruthy(),
    );
    expect(
      sent.some((config) => config.url === '/api/wallets/' || config.url?.includes('/eligibility-requests/')),
    ).toBe(false);
    expect(screen.queryByText(/PRIVATE/)).toBeNull();
    fireEvent.change(select, { target: { value: nominations[0].uuid } });
    fireEvent.change(screen.getByLabelText('Wallet approval expiry'), { target: { value: '2027-01-05T12:00' } });
    expect(screen.getByRole('button', { name: 'Prepare wallet instruction' }).hasAttribute('disabled')).toBe(
      capability === 'apply',
    );
  },
);
it('lets a read-register-only appointee inspect minimal nominations and retained instructions without write actions', async () => {
  appointments = [appointment(['read_register'])];
  seedNomination();
  instructions = [
    prepare({
      operationId: uuid(80),
      appointment: appointmentId,
      company,
      action: 'add',
      nomination: nominations[0].uuid,
      expiresAt: expiry,
    }),
  ];
  await companyView();
  await screen.findByText('Synthetic Administrator');
  const select = screen.getByRole('combobox', { name: 'Wallet instruction target' });
  expect(within(select).getByRole('option', { name: new RegExp(nominations[0].uuid) })).toBeTruthy();
  for (const url of [nominatedUrl, targetsUrl, instructionsUrl])
    expect(sent.some((config) => config.method === 'get' && config.url === url)).toBe(true);
  expect(screen.getByRole('button', { name: 'Prepare wallet instruction' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare wallet instruction' }));
  for (const name of ['Approve wallet instruction', 'Apply wallet instruction', 'Reject wallet instruction'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
  expect(sent.some((config) => config.url === '/api/wallets/' || config.url?.includes('/eligibility-requests/'))).toBe(
    false,
  );
  expect(screen.queryByText(/PRIVATE/)).toBeNull();
});
it('prepares removal from a genuine retained ADD target after wallet deletion', async () => {
  wallets = [];
  targets = [
    {
      uuid: uuid(70),
      company,
      address: '0x' + 'a'.repeat(40),
      chainId: 84532,
      registryAddress: '0x' + 'c'.repeat(40),
      expiresAt: expiry,
      status: 'confirmed',
      completedAt: timestamp,
    },
  ];
  await companyView();
  fireEvent.change(screen.getByLabelText('Wallet instruction action'), { target: { value: 'remove' } });
  fireEvent.change(screen.getByLabelText('Wallet instruction target'), { target: { value: uuid(70) } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare wallet instruction' }));
  await waitFor(() => expect(instructions).toHaveLength(1));
  expect(body(posts(instructionsUrl)[0])).toEqual({
    operationId: instructions[0].uuid,
    appointment: appointmentId,
    company,
    action: 'remove',
    targetChange: uuid(70),
  });
  expect(sent.some((config) => config.url === '/api/wallets/')).toBe(false);
  expect(await screen.findByText('Original ADD target')).toBeTruthy();
});
it('recovers preparation with the original body after nomination loss and prepare capability disappearance', async () => {
  seedNomination();
  losePreparation = true;
  await companyView();
  await prepareAdd();
  await screen.findByRole('button', { name: 'Recover original wallet preparation' });
  const original = body(posts(instructionsUrl)[0]);
  nominations = [];
  appointments = [appointment(['apply'])];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company wallet instructions' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Prepare wallet instruction' }).hasAttribute('disabled')).toBe(true),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recover original wallet preparation' }));
  await waitFor(() => expect(posts(instructionsUrl)).toHaveLength(2));
  expect(body(posts(instructionsUrl)[1])).toEqual(original);
  expect(instructions).toHaveLength(1);
});
it('retains an admitted apply body and key through failed appointment reads and recovers the signed original', async () => {
  seedNomination();
  await companyView();
  await prepareAdd();
  await decision('Approve');
  await waitFor(() => expect(instructions[0].stage).toBe('approved'));
  loseApply = true;
  await decision('Apply');
  const url = `${instructionsUrl}${instructions[0].uuid}/decide/`;
  await screen.findByRole('button', { name: 'Recover original decision receipt' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('button', { name: 'Recover apply wallet instruction receipt' });
  const original = body(posts(url).at(-1)!);
  nominations = [];
  sourceLost = true;
  const key = ['company-wallet-appointments', uuid(50), account, 0];
  act(() =>
    client
      .getQueryCache()
      .find({ queryKey: key, exact: true })!
      .setState({ status: 'error', error: new Error('Synthetic appointment read unavailable') }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Recover apply wallet instruction receipt' })).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company wallet instructions' }));
  await screen.findByRole('button', { name: 'Recover apply wallet instruction receipt' });
  fireEvent.click(screen.getByRole('button', { name: 'Recover apply wallet instruction receipt' }));
  await waitFor(() => expect(posts(url).filter((config) => body(config).kind === 'apply')).toHaveLength(2));
  expect(body(posts(url).at(-1)!)).toEqual(original);
  await screen.findByText('Original transaction signed; awaiting confirmation');
  expect(instructions[0].changeId).toBe(uuid(200));
});
it.each(['wallet', 'account', 'request'] as const)(
  'refuses the actual nomination transport after the reviewed %s scope changes',
  async (change) => {
    await participant();
    fireEvent.click(screen.getByRole('button', { name: 'Review wallet nomination' }));
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Share this selected address with this exact company.' }),
    );
    let release!: () => void;
    const hold = new Promise<void>((done) => (release = done));
    let entered = false;
    const interceptor = apiClient.interceptors.request.use(async (config) => {
      if (config.method === 'post' && config.url === ownUrl) {
        entered = true;
        await hold;
      }
      return config;
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Submit wallet nomination' }));
      await waitFor(() => expect(entered).toBe(true));
      act(() => {
        if (change === 'wallet')
          client.setQueryData(
            ['wallets', 'nomination', uuid(50), account, 0],
            [{ ...wallets[0], address: '0x' + 'f'.repeat(40) }, wallets[1]],
          );
        if (change === 'account')
          client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
            data: { userProfile: uuid(51), userAccount: { uuid: uuid(52), role: 'investor' } },
          });
      });
      if (change === 'request')
        fireEvent.click(screen.getByRole('button', { name: `View request ${requests[1].uuid}` }));
      await act(async () => {
        release();
        await new Promise((done) => setTimeout(done, 0));
      });
      expect(posts(ownUrl)).toHaveLength(0);
      expect(nominations).toHaveLength(0);
      if (change !== 'wallet')
        expect(
          screen.queryByRole('checkbox', { name: 'Share this selected address with this exact company.' }),
        ).toBeNull();
    } finally {
      apiClient.interceptors.request.eject(interceptor);
    }
  },
);
it('ends the old address-sharing consent and refuses nomination redispatch after same-account session loss during CSRF refresh', async () => {
  await participant();
  fireEvent.click(screen.getByRole('button', { name: 'Review wallet nomination' }));
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'Share this selected address with this exact company.' }),
  );
  const previous = apiClient.defaults.adapter;
  let release!: () => void,
    refreshing = false;
  const hold = new Promise<void>((done) => (release = done));
  apiClient.defaults.adapter = async (config) => {
    if (config.method === 'post' && config.url === ownUrl) {
      sent.push(config);
      throw new AxiosError('Synthetic CSRF expiry', undefined, config, undefined, {
        ...response(config, { detail: 'CSRF Failed: synthetic' }),
        status: 403,
      });
    }
    if (config.method === 'get' && config.url === AUTH_ENDPOINTS.VERIFY) {
      refreshing = true;
      await hold;
      return response(config, { valid: true });
    }
    return (previous as (value: InternalAxiosRequestConfig) => Promise<ReturnType<typeof response>>)(config);
  };
  fireEvent.click(screen.getByRole('button', { name: 'Submit wallet nomination' }));
  await waitFor(() => expect(refreshing).toBe(true));
  act(() => client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } }));
  act(() => client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } }));
  await act(async () => {
    release();
    await new Promise((done) => setTimeout(done, 0));
  });
  expect(posts(ownUrl)).toHaveLength(1);
  expect(nominations).toHaveLength(0);
  expect(screen.queryByRole('checkbox', { name: 'Share this selected address with this exact company.' })).toBeNull();
});
it('refuses the actual fresh approval redispatch when the exact company nomination disappears during CSRF refresh', async () => {
  seedNomination();
  await companyView();
  await prepareAdd();
  const previous = apiClient.defaults.adapter,
    url = `${instructionsUrl}${instructions[0].uuid}/decide/`;
  let release!: () => void,
    refreshing = false;
  const hold = new Promise<void>((done) => (release = done));
  apiClient.defaults.adapter = async (config) => {
    if (config.method === 'post' && config.url === url) {
      sent.push(config);
      throw new AxiosError('Synthetic CSRF expiry', undefined, config, undefined, {
        ...response(config, { detail: 'CSRF Failed: synthetic' }),
        status: 403,
      });
    }
    if (config.method === 'get' && config.url === AUTH_ENDPOINTS.VERIFY) {
      refreshing = true;
      await hold;
      return response(config, { valid: true });
    }
    return (previous as (value: InternalAxiosRequestConfig) => Promise<ReturnType<typeof response>>)(config);
  };
  await decision('Approve');
  await waitFor(() => expect(refreshing).toBe(true));
  act(() => client.setQueryData(['company-wallet-nominations', uuid(50), account, 0, company], []));
  await act(async () => {
    release();
    await new Promise((done) => setTimeout(done, 0));
  });
  expect(posts(url)).toHaveLength(1);
  expect(instructions[0].stage).toBe('submitted');
  expect(instructions[0].decisions).toHaveLength(0);
});
