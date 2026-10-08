import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as Crypto from 'expo-crypto';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
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
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope, getSessionEpoch } from '../../services/sessionScope';
import { ParticipantEligibilityScreen } from './ParticipantEligibilityScreen';
import { CompanyEligibilityScreen } from './CompanyEligibilityScreen';

const mockNavigate = jest.fn();
const mockAccess = jest.fn<Promise<string | null>, []>();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ getParent: () => ({ navigate: mockNavigate }) }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../../services/tokenStorage', () => ({
  getAccessToken: () => mockAccess(),
  getRefreshToken: async () => 'synthetic-refresh',
  captureRefreshSession: async () => 1,
  storeTokens: async () => undefined,
  clearTokens: async () => undefined,
}));

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
const originalAdapter = apiClient.defaults.adapter,
  originalBase = apiClient.defaults.baseURL,
  originalEnvironment = process.env.EXPO_PUBLIC_API_URL;
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
function provenNomination(input: Record<string, unknown>, id: string): WalletNomination {
  const value = preview(input);
  if (!value.canSubmit || !value.decision || !value.proof || !value.proofCompletedAt || !value.eligibilityExpiresAt)
    throw new Error('The synthetic nomination needs genuine completed proof and accepted eligibility.');
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
  mockAccess.mockReset().mockResolvedValue('synthetic-access');
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
  jest.mocked(Crypto.randomUUID).mockImplementation(() => uuid(++sequence));
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  apiClient.defaults.baseURL = process.env.EXPO_PUBLIC_API_URL;
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
afterEach(async () => {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await cleanup();
  client.clear();
  apiClient.defaults.adapter = originalAdapter;
  apiClient.defaults.baseURL = originalBase;
  process.env.EXPO_PUBLIC_API_URL = originalEnvironment;
});
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );
}
async function participant() {
  const view = await render(<ParticipantEligibilityScreen />, { wrapper });
  await waitFor(() => expect(view.getByLabelText(`Open eligibility request ${requestId}`)).toBeTruthy());
  await fireEvent.press(view.getByLabelText(`Open eligibility request ${requestId}`));
  await waitFor(() => expect(view.getByLabelText(`Select nomination wallet ${walletId}`)).toBeTruthy());
  await fireEvent.press(view.getByLabelText(`Select nomination wallet ${walletId}`));
  return view;
}
async function nominate(view: Awaited<ReturnType<typeof participant>>) {
  await fireEvent.press(view.getByText('Review wallet nomination'));
  await waitFor(() => expect(view.getByText('Share this selected address with this exact company')).toBeTruthy());
  await fireEvent.press(view.getByText('Share this selected address with this exact company'));
  await fireEvent.press(view.getByText('Submit wallet nomination'));
  await waitFor(() => expect(nominations).toHaveLength(1));
}
async function companyView() {
  const view = await render(<CompanyEligibilityScreen />, { wrapper });
  await waitFor(() => expect(view.getByLabelText('Select wallet instruction company Company A')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Select wallet instruction company Company A'));
  await waitFor(() => expect(sent.some((config) => config.url === instructionsUrl)).toBe(true));
  return view;
}
const seedNomination = () => {
  nominations = [provenNomination({ request: requestId, wallet: walletId }, uuid(60))];
};
async function prepareAdd(view: Awaited<ReturnType<typeof companyView>>) {
  await waitFor(() =>
    expect(view.getByLabelText(`Select shared wallet nomination ${nominations[0].uuid}`)).toBeTruthy(),
  );
  await fireEvent.press(view.getByLabelText(`Select shared wallet nomination ${nominations[0].uuid}`));
  await fireEvent.press(view.getByText('Choose wallet approval expiry date'));
  await fireEvent(
    view.getByTestId('eligibility-expiry-Wallet approval expiry'),
    'onChange',
    { type: 'set' },
    new Date(expiry),
  );
  await fireEvent.press(view.getByText('Prepare company wallet instruction'));
  await waitFor(() => expect(instructions).toHaveLength(1));
}

it('separately shares exactly one selected own wallet with company A, without exposing the other wallet or company B', async () => {
  const view = await participant();
  await fireEvent.press(view.getByText('Review wallet nomination'));
  await waitFor(() => expect(view.getByText('Share this selected address with this exact company')).toBeTruthy());
  await fireEvent.press(view.getByText('Submit wallet nomination'));
  expect(posts(ownUrl)).toHaveLength(0);
  await fireEvent.press(view.getByText('Share this selected address with this exact company'));
  await fireEvent.press(view.getByText('Submit wallet nomination'));
  await waitFor(() => expect(nominations).toHaveLength(1));
  expect(body(posts(ownUrl)[0])).toEqual({
    operationId: nominations[0].uuid,
    request: requestId,
    wallet: walletId,
    previewDigest: digest,
    sharingAccepted: true,
  });
  await view.unmount();
  sent = [];
  const companyScreen = await companyView();
  await waitFor(() => expect(companyScreen.getByText(wallets[0].address)).toBeTruthy());
  expect(companyScreen.queryByText(wallets[1].address)).toBeNull();
  expect(companyScreen.queryByText(/PRIVATE/)).toBeNull();
  expect(sent.some((config) => config.url === '/api/wallets/')).toBe(false);
  expect(nominations.some((row) => row.company === otherCompany)).toBe(false);
});
it('refreshes a legacy VERIFIED wallet’s real proof through the existing route and re-previews before nomination', async () => {
  hasProof = false;
  const view = await participant();
  await fireEvent.press(view.getByText('Review wallet nomination'));
  await waitFor(() => expect(view.getByText('Refresh ordinary possession proof for this exact wallet.')).toBeTruthy());
  await fireEvent.press(view.getByText('Share this selected address with this exact company'));
  await fireEvent.press(view.getByText('Submit wallet nomination'));
  expect(posts(ownUrl)).toHaveLength(0);
  await fireEvent.press(view.getByText('Refresh selected wallet possession proof'));
  expect(mockNavigate).toHaveBeenCalledWith('Wallets', {
    initial: false,
    screen: 'WalletVerification',
    params: { wallet: wallets[0], nomination: { request: requestId, company } },
  });
  hasProof = true;
  await nominate(view);
  expect(nominations[0].proofCompletedAt).toBe(timestamp);
});
it('retains the original lost nomination body and key for recovery after source loss', async () => {
  loseNomination = true;
  const view = await participant();
  await nominate(view);
  await waitFor(() => expect(view.getByText('Recover original nomination')).toBeTruthy());
  const original = body(posts(ownUrl)[0]);
  sourceLost = true;
  await fireEvent.press(view.getByText('Refresh wallet nomination'));
  await waitFor(() => expect(view.getByText('Recover original nomination')).toBeTruthy());
  await fireEvent.press(view.getByText('Recover original nomination'));
  await waitFor(() => expect(posts(ownUrl)).toHaveLength(2));
  expect(body(posts(ownUrl)[1])).toEqual(original);
  expect(nominations).toHaveLength(1);
});
it.each(['admin', 'apply'] as const)(
  'permits current %s minimal company reads without the old private evidence queue',
  async (capability) => {
    seedNomination();
    appointments = [appointment([capability])];
    const view = await companyView();
    await waitFor(() => expect(view.getByText(wallets[0].address)).toBeTruthy());
    expect(view.queryByText('Selected company request')).toBeNull();
    expect(sent.some((config) => config.url?.includes('/eligibility-requests/'))).toBe(false);
    expect(sent.some((config) => config.url === '/api/wallets/')).toBe(false);
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
  const view = await companyView();
  await waitFor(() => expect(view.getByText('Synthetic Administrator')).toBeTruthy());
  expect(view.getByText('Addresses explicitly shared with this company')).toBeTruthy();
  expect(view.getAllByText(wallets[0].address)).toHaveLength(2);
  for (const url of [nominatedUrl, targetsUrl, instructionsUrl])
    expect(sent.some((config) => config.method === 'get' && config.url === url)).toBe(true);
  expect(view.queryByText('Prepare company wallet instruction')).toBeNull();
  for (const name of ['Approve wallet instruction', 'Apply wallet instruction', 'Reject wallet instruction'])
    expect(view.queryByText(name)).toBeNull();
  expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
  expect(sent.some((config) => config.url === '/api/wallets/' || config.url?.includes('/eligibility-requests/'))).toBe(
    false,
  );
  expect(view.queryByText('Selected company request')).toBeNull();
});
it('prepares removal from a retained successful ADD after wallet deletion, without an account wallet directory', async () => {
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
  const view = await companyView();
  await waitFor(() => expect(view.getByText('Remove a retained company wallet target')).toBeTruthy());
  await fireEvent.press(view.getByText('Remove a retained company wallet target'));
  await fireEvent.press(view.getByLabelText(`Select retained wallet target ${targets[0].uuid}`));
  await fireEvent.press(view.getByText('Prepare company wallet instruction'));
  await waitFor(() => expect(instructions).toHaveLength(1));
  expect(body(posts(instructionsUrl)[0])).toEqual({
    action: 'remove',
    targetChange: targets[0].uuid,
    operationId: instructions[0].uuid,
    appointment: appointmentId,
    company,
  });
  expect(instructions[0].nomination).toBeNull();
  expect(sent.some((config) => config.url === '/api/wallets/')).toBe(false);
});
it('recovers original preparation and applied signed receipts through nomination loss and appointment refresh without replacement', async () => {
  seedNomination();
  const originalNominations = nominations;
  losePreparation = true;
  const view = await companyView();
  await prepareAdd(view);
  await waitFor(() => expect(view.getByText('Recover original wallet preparation')).toBeTruthy());
  const prepared = body(posts(instructionsUrl)[0]);
  nominations = [];
  await fireEvent.press(view.getByText('Refresh company wallet instructions'));
  await waitFor(() => expect(view.getByText('Recover original wallet preparation')).toBeTruthy());
  await fireEvent.press(view.getByText('Recover original wallet preparation'));
  await waitFor(() =>
    expect(
      view.getByLabelText(`Approve wallet instruction the wallet instruction ${instructions[0].uuid}`),
    ).toBeTruthy(),
  );
  expect(body(posts(instructionsUrl)[1])).toEqual(prepared);
  nominations = originalNominations;
  await fireEvent.press(view.getByText('Refresh company wallet instructions'));
  await waitFor(() =>
    expect(view.getByLabelText(`Select shared wallet nomination ${nominations[0].uuid}`)).toBeTruthy(),
  );
  await fireEvent.press(
    view.getByLabelText(`Approve wallet instruction the wallet instruction ${instructions[0].uuid}`),
  );
  await waitFor(() =>
    expect(
      view.getByText('Approve the exact company, selected wallet target, source, expiry and transaction intent shown.'),
    ).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Confirm'));
  await waitFor(() => expect(instructions[0].stage).toBe('approved'));
  loseApply = true;
  await fireEvent.press(view.getByLabelText(`Apply wallet instruction the wallet instruction ${instructions[0].uuid}`));
  await waitFor(() =>
    expect(
      view.getByText(
        'Admit this exact approved instruction once for guarded execution. Admission does not confirm chain approval.',
      ),
    ).toBeTruthy(),
  );
  await fireEvent.press(view.getByText('Confirm'));
  await waitFor(() =>
    expect(
      view.getByLabelText(`Recover apply wallet instruction receipt for wallet instruction ${instructions[0].uuid}`),
    ).toBeTruthy(),
  );
  const decideUrl = `${instructionsUrl}${instructions[0].uuid}/decide/`,
    original = body(posts(decideUrl)[1]);
  nominations = [];
  sourceLost = true;
  appointments = [appointment(['apply'])];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-wallet-appointments'] });
  });
  await waitFor(() =>
    expect(
      view.getByLabelText(`Recover apply wallet instruction receipt for wallet instruction ${instructions[0].uuid}`),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    view.getByLabelText(`Recover apply wallet instruction receipt for wallet instruction ${instructions[0].uuid}`),
  );
  await waitFor(() => expect(posts(decideUrl)).toHaveLength(3));
  expect(body(posts(decideUrl)[2])).toEqual(original);
  expect(instructions).toHaveLength(1);
  expect(instructions[0].changeId).toBe(uuid(200));
  await waitFor(() => expect(view.getByText('Original transaction signed; awaiting confirmation')).toBeTruthy());
});

it.each(['actor', 'account', 'request', 'wallet address', 'epoch', 'same-id session'] as const)(
  'refuses old nomination transport after pending bearer retrieval and %s scope change',
  async (change) => {
    const view = await participant();
    await fireEvent.press(view.getByText('Review wallet nomination'));
    await waitFor(() => expect(view.getByText('Share this selected address with this exact company')).toBeTruthy());
    await fireEvent.press(view.getByText('Share this selected address with this exact company'));
    let resolve!: (value: string | null) => void;
    const pending = new Promise<string | null>((done) => {
      resolve = done;
    });
    const before = mockAccess.mock.calls.length;
    mockAccess.mockReturnValueOnce(pending);
    await fireEvent.press(view.getByText('Submit wallet nomination'));
    await waitFor(() => expect(mockAccess).toHaveBeenCalledTimes(before + 1));
    if (change === 'actor' || change === 'account')
      await act(() =>
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: {
            userProfile: change === 'actor' ? uuid(51) : uuid(50),
            userAccount: { uuid: change === 'account' ? uuid(52) : account, role: 'investor' },
          },
        }),
      );
    if (change === 'request') await fireEvent.press(view.getByLabelText(`Open eligibility request ${uuid(40)}`));
    if (change === 'wallet address')
      await act(() => {
        wallets = [{ ...wallets[0], address: '0x' + 'f'.repeat(40) }, wallets[1]];
        client.setQueryData(['wallets', 'nomination', uuid(50), account, getSessionEpoch()], wallets);
      });
    if (change === 'epoch') await act(() => invalidateSessionScope());
    if (change === 'same-id session')
      await act(() => {
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
      });
    await act(async () => {
      resolve('synthetic-access');
      await pending;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(posts(ownUrl)).toHaveLength(0);
    expect(nominations).toHaveLength(0);
    if (change !== 'wallet address')
      expect(view.queryByText('Share this selected address with this exact company')).toBeNull();
  },
);

it('refuses a fresh company ADD decision at actual transport after its selected nomination source is lost', async () => {
  seedNomination();
  const view = await companyView();
  await prepareAdd(view);
  await waitFor(() =>
    expect(
      view.getByLabelText(`Approve wallet instruction the wallet instruction ${instructions[0].uuid}`),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    view.getByLabelText(`Approve wallet instruction the wallet instruction ${instructions[0].uuid}`),
  );
  await waitFor(() =>
    expect(
      view.getByText('Approve the exact company, selected wallet target, source, expiry and transaction intent shown.'),
    ).toBeTruthy(),
  );
  let resolve!: (value: string | null) => void;
  const pending = new Promise<string | null>((done) => {
    resolve = done;
  });
  const before = mockAccess.mock.calls.length;
  mockAccess.mockReturnValueOnce(pending);
  await fireEvent.press(view.getByText('Confirm'));
  await waitFor(() => expect(mockAccess).toHaveBeenCalledTimes(before + 1));
  await act(() =>
    client.setQueryData(['company-wallet-nominations', uuid(50), account, getSessionEpoch(), company], []),
  );
  await act(async () => {
    resolve('synthetic-access');
    await pending;
  });
  expect(posts(`${instructionsUrl}${instructions[0].uuid}/decide/`)).toHaveLength(0);
  expect(instructions[0].decisions).toHaveLength(0);
});
