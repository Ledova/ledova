import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyEligibilityRequest,
  type CompanyEligibilitySharedSummary,
  type InvestorClassification,
  type InvestorCategory,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { clearTokens, storeTokens } from '../../services/tokenStorage';
import { ParticipantEligibilityScreen } from './ParticipantEligibilityScreen';
import { CompanyEligibilityScreen } from './CompanyEligibilityScreen';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const uuid = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const account = uuid(1);
const company = uuid(2);
const otherCompany = uuid(3);
const requestId = uuid(4);
const appointmentId = uuid(5);
const expiry = '2027-01-05T12:00:00.000Z';
const submittedAt = '2026-10-05T12:00:00.000Z';
const ownUrl = '/api/v1/company-eligibility/requests/';
const sourceUrl = '/api/investor-classifications/';
const appointmentUrl = '/api/v1/company-authority/appointments/';
const queueUrl = `/api/v1/companies/${company}/eligibility-requests/`;
const digest = 'a'.repeat(64);
const tokens = new Map<string, string>();
const initialAdapter = apiClient.defaults.adapter;
const initialBase = apiClient.defaults.baseURL;
const initialEnvironment = process.env.EXPO_PUBLIC_API_URL;
let client: QueryClient;
let sent: InternalAxiosRequestConfig[];
let sources: InvestorClassification[];
let appointments: OwnCompanyAppointment[];
let history: CompanyEligibilityRequest[];
let sequence: number;
let unmet: string[];
let failCreate: boolean;
let failDecision: boolean;
let foreignReceipt: boolean;
let malformedPreview: boolean;

function source(category: InvestorCategory, index = 10): InvestorClassification {
  return {
    uuid: uuid(index),
    userAccount: account,
    category,
    categoryDisplay: category,
    status: 'submitted',
    statusDisplay: 'Submitted',
    createdAt: submittedAt,
    submittedAt,
    reviewedAt: null,
    expiresAt: null,
    isLive: false,
    isExpired: false,
    declarationAccepted: true,
    declarationText: `Synthetic ${category} declaration`,
    declaredBasis: 'PRIVATE financial basis',
    reviewNotes: 'PRIVATE staff notes',
    rejectionReason: '',
    evidenceFileSize: 25,
    evidenceMimeType: 'application/pdf',
    company: category === 'associated_person' ? company : null,
    certificateIssuedAt: category === 'accountant_certificate' ? '2026-10-01' : null,
    certifierName: category === 'accountant_certificate' ? 'Synthetic Accountant' : '',
    certifierBody: category === 'accountant_certificate' ? 'cpa_australia' : '',
    certifierMembershipNumber: category === 'accountant_certificate' ? 'MEMBER-001' : '',
  };
}

function summary(item = sources[0], input: Record<string, unknown> = {}): CompanyEligibilitySharedSummary {
  const result: CompanyEligibilitySharedSummary = {
    category: item.category,
    source: item.uuid,
    userAccount: account,
    company: String(input.company ?? company),
    declarationText: item.declarationText,
    submittedAt,
    requestedExpiresAt: String(input.requestedExpiresAt ?? expiry),
  };
  if (item.category === 'accountant_certificate')
    Object.assign(result, {
      certificateIssuedAt: item.certificateIssuedAt,
      certifierName: item.certifierName,
      certifierBody: item.certifierBody,
      certifierMembershipNumber: item.certifierMembershipNumber,
    });
  if (item.category === 'associated_person') result.associatedCompany = company;
  if (item.category === 'product_value')
    Object.assign(result, {
      offering: input.offering,
      token: uuid(30),
      quantity: input.quantity,
      pricePerShare: '10000.00',
      priceCurrency: 'AUD',
      amountAud: '500000.00',
      offeringTerms: { approved: true, share_class: uuid(30), offering: input.offering, price_per_share: '10000.00' },
      offeringTermsDigest: digest,
    });
  return result;
}

function record(value = summary()): CompanyEligibilityRequest {
  return {
    uuid: requestId,
    company: value.company,
    userAccount: account,
    source: value.source,
    category: value.category,
    sharedSummary: value,
    requestedExpiresAt: value.requestedExpiresAt,
    submittedAt,
    submittedBy: 1,
    digest,
    evidenceHash: digest,
    sourceFingerprint: digest,
    idempotencyKey: uuid(40),
    version: '1',
    outcome: 'pending',
    decision: null,
    withdrawal: null,
  };
}

function accepted(): CompanyEligibilityRequest {
  const value = record();
  return {
    ...value,
    outcome: 'accepted',
    decision: {
      uuid: uuid(41),
      appointment: appointmentId,
      decidedAt: submittedAt,
      decidedBy: 2,
      digest,
      requestDigest: digest,
      expiresAt: expiry,
      idempotencyKey: uuid(42),
      outcome: 'accepted',
      reason: '',
      revocation: null,
    },
  };
}

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200) {
  return { config, data, status, statusText: 'OK', headers: {} };
}

function input(config: InternalAxiosRequestConfig): Record<string, unknown> {
  return JSON.parse(String(config.data));
}

beforeEach(async () => {
  tokens.clear();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => tokens.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    tokens.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    tokens.delete(key);
  });
  await clearTokens();
  await storeTokens({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  apiClient.defaults.baseURL = process.env.EXPO_PUBLIC_API_URL;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: uuid(50), userAccount: { uuid: account, role: 'investor' } },
  });
  sources = [source('professional_investor')];
  appointments = [
    {
      uuid: appointmentId,
      company,
      companyName: 'Synthetic Company',
      source: 'invitation',
      capabilities: ['approve'],
      delegatableCapabilities: [],
      status: 'active',
      isEffective: true,
      expiresAt: null,
      revokedAt: null,
      createdAt: submittedAt,
      declarationText: 'Synthetic appointment declaration',
      declarationVersion: '2026-10-04',
    },
  ];
  history = [];
  sent = [];
  sequence = 100;
  unmet = [];
  failCreate = false;
  failDecision = false;
  foreignReceipt = false;
  malformedPreview = false;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => uuid(++sequence));
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    if (config.method === 'get') {
      if (config.url === sourceUrl) return response(config, { results: sources, count: sources.length, next: null });
      if (config.url === appointmentUrl)
        return response(config, { results: appointments, count: appointments.length, next: null });
      if (config.url === ownUrl || config.url === queueUrl)
        return response(config, { results: history, count: history.length, next: null });
      if (config.url === `${ownUrl}${requestId}/` || config.url === `${queueUrl}${requestId}/`)
        return response(config, history[0]);
      throw new Error(`Unexpected eligibility read ${config.url}`);
    }
    const body = input(config);
    if (config.url === `${ownUrl}preview/`) {
      const item = sources.find((candidate) => candidate.uuid === body.source)!;
      return response(config, {
        version: '1',
        sharedSummary: summary(item, body),
        evidenceHash: digest,
        sourceFingerprint: digest,
        previewDigest: digest,
        unmetRequirements: unmet,
        canSubmit: unmet.length === 0,
      });
    }
    if (config.url === ownUrl) {
      if (failCreate) {
        failCreate = false;
        throw new AxiosError('Synthetic lost response', AxiosError.ERR_NETWORK, config);
      }
      const value = {
        ...record(summary(sources.find((item) => item.uuid === body.source)!, body)),
        idempotencyKey: String(body.idempotencyKey),
        ...(foreignReceipt ? { userAccount: uuid(99) } : {}),
      };
      history = [value];
      return response(config, value, 201);
    }
    if (config.url === `${queueUrl}${requestId}/decision-preview/`)
      return response(config, {
        previewDigest: digest,
        unmetRequirements: unmet,
        canDecide: malformedPreview || unmet.length === 0,
      });
    if (config.url === `${queueUrl}${requestId}/decide/`) {
      if (failDecision) {
        failDecision = false;
        throw new AxiosError('Synthetic lost decision response', AxiosError.ERR_NETWORK, config);
      }
      const value: CompanyEligibilityRequest = {
        ...history[0],
        outcome: body.outcome as 'accepted' | 'refused',
        decision: {
          uuid: uuid(60),
          decidedBy: 2,
          decidedAt: submittedAt,
          appointment: String(body.appointment),
          digest,
          requestDigest: history[0].digest,
          idempotencyKey: String(body.idempotencyKey),
          outcome: body.outcome as 'accepted' | 'refused',
          expiresAt: body.expiresAt ? String(body.expiresAt) : null,
          reason: String(body.reason ?? ''),
          revocation: null,
        },
      };
      history = [value];
      return response(config, value);
    }
    if (config.url === `${ownUrl}${requestId}/withdraw/`) {
      history = [
        {
          ...history[0],
          outcome: 'withdrawn',
          withdrawal: {
            uuid: uuid(61),
            idempotencyKey: String(body.idempotencyKey),
            withdrawnBy: 1,
            withdrawnAt: submittedAt,
            digest,
          },
        },
      ];
      return response(config, history[0]);
    }
    if (config.url === `${queueUrl}${requestId}/revoke/`) {
      history = [
        {
          ...history[0],
          outcome: 'revoked',
          decision: {
            ...history[0].decision!,
            revocation: {
              uuid: uuid(62),
              idempotencyKey: String(body.idempotencyKey),
              revokedBy: 2,
              revokedAt: submittedAt,
              appointment: String(body.appointment),
              reason: String(body.reason),
              digest,
            },
          },
        },
      ];
      return response(config, history[0]);
    }
    throw new Error(`Unexpected eligibility write ${config.url}`);
  };
});

afterEach(async () => {
  await cleanup();
  client.clear();
  apiClient.defaults.adapter = initialAdapter;
  apiClient.defaults.baseURL = initialBase;
  if (initialEnvironment === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = initialEnvironment;
});

async function page(kind: 'participant' | 'company') {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        {kind === 'participant' ? <ParticipantEligibilityScreen /> : <CompanyEligibilityScreen />}
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof page>>;

function pressHandler(view: Screen, name: string): () => void {
  let fiber = view.getByRole('button', { name }).unstable_fiber;
  while (fiber) {
    if (typeof fiber.memoizedProps?.onPress === 'function') return fiber.memoizedProps.onPress;
    fiber = fiber.return;
  }
  throw new Error(`No press handler for ${name}`);
}

async function chooseExpiry(view: Screen, label = 'Requested expiry') {
  await fireEvent.press(view.getByRole('button', { name: `Choose ${label.toLowerCase()} date` }));
  await fireEvent(view.getByTestId(`eligibility-expiry-${label}`), 'onChange', { type: 'set' }, new Date(expiry));
  const done = view.queryByRole('button', { name: `Done choosing ${label.toLowerCase()}` });
  if (done) await fireEvent.press(done);
}

async function participantPreview(view: Screen) {
  await fireEvent.press(await view.findByRole('radio', { name: `Select evidence ${sources[0].uuid}` }));
  if (sources[0].category === 'product_value') {
    await fireEvent.changeText(view.getByLabelText('Approved offering UUID'), uuid(31));
    await fireEvent.changeText(view.getByLabelText('Whole-share quantity'), '50');
  } else await fireEvent.changeText(view.getByLabelText('Company UUID'), company);
  await chooseExpiry(view);
  await fireEvent.press(view.getByRole('button', { name: 'Preview sharing request' }));
  await view.findByRole('checkbox', { name: 'Share this exact summary with this company' });
}

async function consents(view: Screen) {
  await fireEvent.press(view.getByRole('checkbox', { name: 'Share this exact summary with this company' }));
  await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm this exact declaration' }));
}

async function companyRecord(view: Screen) {
  await fireEvent.press(await view.findByRole('radio', { name: 'Select eligibility company Synthetic Company' }));
  await fireEvent.press(await view.findByRole('radio', { name: `Select eligibility appointment ${appointmentId}` }));
  await fireEvent.press(await view.findByRole('button', { name: `Open company eligibility request ${requestId}` }));
  await view.findByText('Retained history');
}

it.each(['accountant_certificate', 'professional_investor', 'associated_person', 'product_value'] as const)(
  'previews the real %s summary and submits exact separate consents through bearer transport',
  async (category) => {
    sources = [source(category)];
    const view = await page('participant');
    await participantPreview(view);
    expect(view.getByText(`Synthetic ${category} declaration`)).toBeTruthy();
    expect(view.getByText('Participant account')).toBeTruthy();
    expect(view.getByText(account)).toBeTruthy();
    expect(view.getByText(uuid(101))).toBeTruthy();
    expect(view.getAllByText(digest).length).toBeGreaterThan(0);
    if (category === 'accountant_certificate') {
      expect(view.getByText('Synthetic Accountant')).toBeTruthy();
      expect(view.getByText('MEMBER-001')).toBeTruthy();
      expect(view.getByText('2026-10-01')).toBeTruthy();
    }
    if (category === 'associated_person') expect(view.getByText('Associated issuer')).toBeTruthy();
    if (category === 'product_value') {
      expect(view.getByText(uuid(31))).toBeTruthy();
      expect(view.getByText(uuid(30))).toBeTruthy();
      expect(view.getByText('50')).toBeTruthy();
      expect(view.getByText('AUD\u00a0500,000.00')).toBeTruthy();
      expect(
        view.getByText(
          JSON.stringify(summary(sources[0], { offering: uuid(31), quantity: 50 }).offeringTerms, null, 2),
        ),
      ).toBeTruthy();
    }
    expect(view.queryByText('PRIVATE financial basis')).toBeNull();
    expect(view.queryByText('PRIVATE staff notes')).toBeNull();
    expect(view.getByRole('button', { name: 'Submit sharing request' })).toBeDisabled();
    await fireEvent.press(view.getByRole('checkbox', { name: 'Share this exact summary with this company' }));
    expect(view.getByRole('button', { name: 'Submit sharing request' })).toBeDisabled();
    await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm this exact declaration' }));
    await fireEvent.press(view.getByRole('button', { name: 'Submit sharing request' }));
    await view.findByText('Your selected request');
    const dispatched = sent.find((item) => item.method === 'post' && item.url === ownUrl)!;
    expect(dispatched.headers.Authorization).toBe('Bearer synthetic-access');
    expect(input(dispatched)).toEqual({
      source: sources[0].uuid,
      requestedExpiresAt: expiry,
      ...(category === 'product_value' ? { offering: uuid(31), quantity: 50 } : { company }),
      previewDigest: digest,
      idempotencyKey: uuid(101),
      sharingAccepted: true,
      declarationAccepted: true,
    });
    expect(sent.some((item) => item.url === '/api/v1/companies/')).toBe(false);
  },
);

it('keeps server unmet requirements visible without issuing a sharing request', async () => {
  unmet = ['source_evidence_unavailable'];
  const view = await page('participant');
  await participantPreview(view);
  await consents(view);
  expect(view.getByText('source_evidence_unavailable')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Submit sharing request' })).toBeDisabled();
  expect(sent.filter((item) => item.method === 'post' && item.url === ownUrl)).toHaveLength(0);
});

it('allows own retained historically verified evidence to prepare a fresh company request', async () => {
  sources = [
    {
      ...source('professional_investor'),
      status: 'verified',
      statusDisplay: 'Verified',
      isLive: false,
      reviewedAt: submittedAt,
      expiresAt: expiry,
    },
  ];
  const view = await page('participant');
  await participantPreview(view);
  expect(view.getByRole('checkbox', { name: 'Share this exact summary with this company' })).not.toBeChecked();
  expect(sent.some((item) => item.url === `${ownUrl}preview/`)).toBe(true);
});

it('retains an uncertain request key and identical payload for the explicit retry', async () => {
  failCreate = true;
  const view = await page('participant');
  await participantPreview(view);
  await consents(view);
  await fireEvent.press(view.getByRole('button', { name: 'Submit sharing request' }));
  await view.findByText(/The outcome is unconfirmed/);
  await consents(view);
  await fireEvent.press(view.getByRole('button', { name: 'Submit sharing request' }));
  await view.findByText('Your selected request');
  const writes = sent.filter((item) => item.method === 'post' && item.url === ownUrl);
  expect(writes).toHaveLength(2);
  expect(input(writes[1])).toEqual(input(writes[0]));
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});

it('retires the held confirm callback when the known company changes and requires new consents', async () => {
  const view = await page('participant');
  await participantPreview(view);
  await consents(view);
  const confirm = pressHandler(view, 'Submit sharing request');
  await fireEvent.changeText(view.getByLabelText('Company UUID'), otherCompany);
  await act(async () => confirm());
  expect(sent.filter((item) => item.method === 'post' && item.url === ownUrl)).toHaveLength(0);
  await fireEvent.press(view.getByRole('button', { name: 'Preview sharing request' }));
  expect(await view.findByRole('button', { name: 'Submit sharing request' })).toBeDisabled();
  expect(view.getByRole('checkbox', { name: 'Share this exact summary with this company' })).not.toBeChecked();
});

it('prevents the actual request POST after account changes during bearer retrieval', async () => {
  const view = await page('participant');
  await participantPreview(view);
  await consents(view);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
    if (first && key === 'session.tokens.v2') {
      first = false;
      entered();
      await held;
    }
    return tokens.get(key) ?? null;
  });
  await fireEvent.press(view.getByRole('button', { name: 'Submit sharing request' }));
  await started;
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: uuid(98), userAccount: { uuid: uuid(99), role: 'investor' } },
    });
  });
  await act(async () => release());
  await waitFor(() => expect(view.queryByRole('button', { name: 'Submit sharing request' })).toBeNull());
  expect(sent.filter((item) => item.method === 'post' && item.url === ownUrl)).toHaveLength(0);
});

it('refuses a foreign request receipt without presenting it as retained own history', async () => {
  foreignReceipt = true;
  const view = await page('participant');
  await participantPreview(view);
  await consents(view);
  await fireEvent.press(view.getByRole('button', { name: 'Submit sharing request' }));
  await view.findByText(/The outcome is unconfirmed/);
  expect(view.queryByText('Your selected request')).toBeNull();
  expect(view.queryByText(uuid(99))).toBeNull();
});

it('lets a prepare-only investor read and preview the company queue without recording a decision', async () => {
  appointments = [{ ...appointments[0], capabilities: ['prepare'], delegatableCapabilities: ['approve'] }];
  unmet = ['personal_approve_required'];
  history = [record()];
  const view = await page('company');
  await companyRecord(view);
  await chooseExpiry(view, 'Acceptance expiry');
  await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
  expect(await view.findByText('personal_approve_required')).toBeTruthy();
  await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm this exact company decision' }));
  expect(view.getByRole('button', { name: 'Record company decision' })).toBeDisabled();
  expect(
    sent.some(
      (item) => item.url === '/api/v1/companies/' || item.url === `${appointmentUrl}team/` || item.url === sourceUrl,
    ),
  ).toBe(false);
});

it('does not turn a prepare-only local refusal into an uncertain approval retry', async () => {
  appointments = [{ ...appointments[0], capabilities: ['prepare'] }];
  malformedPreview = true;
  history = [record()];
  const view = await page('company');
  await companyRecord(view);
  await chooseExpiry(view, 'Acceptance expiry');
  await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
  await fireEvent.press(await view.findByRole('checkbox', { name: 'Confirm this exact company decision' }));
  const oldConfirm = pressHandler(view, 'Record company decision');
  await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
  await view.findByText('Your exact current personal approve appointment is required to record this action.');
  await act(async () => {
    oldConfirm();
  });
  expect(view.queryByText(/The outcome is unconfirmed/)).toBeNull();
  expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
});

it('prevents the actual company decision POST when its personal appointment is revoked during bearer retrieval', async () => {
  history = [record()];
  const view = await page('company');
  await companyRecord(view);
  await chooseExpiry(view, 'Acceptance expiry');
  await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
  await fireEvent.press(await view.findByRole('checkbox', { name: 'Confirm this exact company decision' }));
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
    if (first && key === 'session.tokens.v2') {
      first = false;
      entered();
      await held;
    }
    return tokens.get(key) ?? null;
  });
  try {
    await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
    await started;
    await act(async () => {
      client.setQueriesData({ queryKey: ['company-appointments'] }, [
        { ...appointments[0], isEffective: false, status: 'revoked', revokedAt: submittedAt },
      ]);
    });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(view.queryByRole('button', { name: 'Record company decision' })).toBeNull());
    expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
  } finally {
    release();
  }
});

it.each(['accepted', 'refused'] as const)('records the exact rendered %s company decision', async (outcome) => {
  history = [record()];
  const view = await page('company');
  await companyRecord(view);
  if (outcome === 'accepted') await chooseExpiry(view, 'Acceptance expiry');
  else {
    await fireEvent.press(view.getByRole('radio', { name: 'Refuse this request' }));
    await fireEvent.changeText(view.getByLabelText('Refusal reason'), 'Exact synthetic refusal');
  }
  await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
  const check = await view.findByRole('checkbox', { name: 'Confirm this exact company decision' });
  expect(view.getByRole('button', { name: 'Record company decision' })).toBeDisabled();
  await fireEvent.press(check);
  await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
  await waitFor(() => expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(true));
  const body = input(sent.find((item) => item.url?.endsWith('/decide/'))!);
  expect(body).toEqual({
    appointment: appointmentId,
    outcome,
    ...(outcome === 'accepted' ? { expiresAt: expiry } : { reason: 'Exact synthetic refusal' }),
    previewDigest: digest,
    idempotencyKey: uuid(101),
    confirmation: true,
  });
  await view.findByText('Company decision');
  expect(view.queryByText('PRIVATE financial basis')).toBeNull();
});

it.each(['expired', 'revoked'] as const)(
  'reopens the same uncertain decision after its original appointment is %s under another current prepare read',
  async (status) => {
    appointments = [...appointments, { ...appointments[0], uuid: uuid(6), capabilities: ['prepare'] }];
    history = [record()];
    failDecision = true;
    const view = await page('company');
    await companyRecord(view);
    await chooseExpiry(view, 'Acceptance expiry');
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    await fireEvent.press(await view.findByRole('checkbox', { name: 'Confirm this exact company decision' }));
    await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
    await view.findByText(/The outcome is unconfirmed/);
    const original = input(sent.find((item) => item.url?.endsWith('/decide/'))!);
    await fireEvent.press(view.getByRole('button', { name: 'Close review' }));
    appointments = [
      {
        ...appointments[0],
        isEffective: false,
        ...(status === 'revoked'
          ? { status: 'revoked' as const, revokedAt: submittedAt }
          : { expiresAt: '2020-01-05T12:00:00.000Z' }),
      },
      appointments[1],
    ];
    await act(async () => {
      client.setQueriesData({ queryKey: ['company-appointments'] }, appointments);
    });
    await waitFor(() =>
      expect(view.queryByRole('radio', { name: `Select eligibility appointment ${appointmentId}` })).toBeNull(),
    );
    expect(view.getByRole('radio', { name: `Select eligibility appointment ${uuid(6)}` })).not.toBeChecked();
    expect(view.getByRole('radio', { name: 'Accept this request' })).toBeDisabled();
    expect(view.getByRole('radio', { name: 'Refuse this request' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Choose acceptance expiry date' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Preview company decision' })).toBeEnabled();
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    expect(await view.findByText(uuid(101))).toBeTruthy();
    expect(view.getByRole('checkbox', { name: 'Confirm this exact company decision' })).not.toBeChecked();
    await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm this exact company decision' }));
    await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
    await view.findByText('Company decision');
    const writes = sent.filter((item) => item.url?.endsWith('/decide/'));
    expect(writes).toHaveLength(2);
    expect(input(writes[1])).toEqual(original);
    expect(input(writes[1]).appointment).toBe(appointmentId);
    expect(input(writes[1]).previewDigest).toBe(digest);
    expect(input(writes[1]).idempotencyKey).toBe(uuid(101));
    expect(sent.filter((item) => item.url?.endsWith('/decision-preview/'))).toHaveLength(1);
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  },
);

it('withdraws an accepted own request through a distinct explicit confirmation', async () => {
  history = [accepted()];
  const view = await page('participant');
  await fireEvent.press(await view.findByRole('button', { name: `Open eligibility request ${requestId}` }));
  await fireEvent.press(await view.findByRole('button', { name: 'Review request withdrawal' }));
  expect(await view.findByRole('button', { name: 'Withdraw request' })).toBeDisabled();
  await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm withdrawal of this request' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await view.findByText('Withdrawn by');
  expect(input(sent.find((item) => item.url?.endsWith('/withdraw/'))!)).toEqual({ idempotencyKey: uuid(101) });
});

it('retires revocation confirmation when its reason changes and records only the fresh exact reason', async () => {
  history = [accepted()];
  const view = await page('company');
  await companyRecord(view);
  await fireEvent.changeText(view.getByLabelText('Revocation reason'), 'Old reason');
  await fireEvent.press(view.getByRole('button', { name: 'Review acceptance revocation' }));
  await fireEvent.press(await view.findByRole('checkbox', { name: 'Confirm revocation of this acceptance' }));
  const confirm = pressHandler(view, 'Revoke acceptance');
  await fireEvent.changeText(view.getByLabelText('Revocation reason'), 'Fresh exact reason');
  await act(async () => confirm());
  expect(sent.some((item) => item.url?.endsWith('/revoke/'))).toBe(false);
  await fireEvent.press(view.getByRole('button', { name: 'Review acceptance revocation' }));
  await fireEvent.press(await view.findByRole('checkbox', { name: 'Confirm revocation of this acceptance' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke acceptance' }));
  await view.findByText('Revoked by');
  expect(input(sent.find((item) => item.url?.endsWith('/revoke/'))!)).toEqual({
    appointment: appointmentId,
    idempotencyKey: uuid(102),
    reason: 'Fresh exact reason',
  });
});

it('does not offer the queue through admin, ownership or delegatable approval alone', async () => {
  appointments = [{ ...appointments[0], capabilities: ['admin'], delegatableCapabilities: ['prepare', 'approve'] }];
  const view = await page('company');
  expect(await view.findByText('You have no current personal Prepare or Approve appointment.')).toBeTruthy();
  expect(sent.some((item) => item.url === queueUrl)).toBe(false);
});

it.each(['revoked', 'removed', 'scope_removed', 'foreign_only'] as const)(
  'hides cached company queue, participant summary, history and review when current personal read is %s',
  async (loss) => {
    history = [record()];
    const view = await page('company');
    await companyRecord(view);
    await chooseExpiry(view, 'Acceptance expiry');
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    await view.findByRole('checkbox', { name: 'Confirm this exact company decision' });
    const retained = client
      .getQueryCache()
      .findAll({ queryKey: ['eligibility-records', 'company'] })
      .find((query) => query.queryKey.at(-1) === requestId)!;
    const data = retained.state.data;
    const lost =
      loss === 'removed'
        ? []
        : [
            {
              ...appointments[0],
              ...(loss === 'revoked'
                ? { status: 'revoked', revokedAt: submittedAt, isEffective: false }
                : loss === 'scope_removed'
                  ? { capabilities: ['admin'], delegatableCapabilities: ['prepare', 'approve'] }
                  : { company: otherCompany }),
            },
          ];
    await act(async () => {
      client.setQueriesData({ queryKey: ['company-appointments'] }, lost);
    });
    await waitFor(() => expect(view.queryByText('Retained history')).toBeNull());
    expect(view.queryByRole('button', { name: `Open company eligibility request ${requestId}` })).toBeNull();
    expect(view.queryByText(sources[0].declarationText)).toBeNull();
    expect(view.queryByRole('checkbox', { name: 'Confirm this exact company decision' })).toBeNull();
    expect(retained.state.data).toBe(data);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['company-appointments'] });
    });
    expect(await view.findByText('Retained history')).toBeTruthy();
    expect(view.getByText(sources[0].declarationText)).toBeTruthy();
    expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
  },
);

it('hides cached company participant records at actual appointment expiry without another read or cache event', async () => {
  history = [record()];
  const view = await page('company');
  await companyRecord(view);
  const expiresAt = new Date(Date.now() + 300).toISOString();
  await act(async () => {
    client.setQueriesData({ queryKey: ['company-appointments'] }, [{ ...appointments[0], expiresAt }]);
  });
  expect(view.getByText('Retained history')).toBeTruthy();
  await waitFor(() => expect(view.queryByText('Retained history')).toBeNull(), { timeout: 2000 });
  expect(view.queryByRole('button', { name: `Open company eligibility request ${requestId}` })).toBeNull();
  expect(view.queryByText(sources[0].declarationText)).toBeNull();
  expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
});

it.each(['appointments', 'queue', 'detail'] as const)(
  'hides cached company summary and action after the current %s read fails until a real successful read',
  async (read) => {
    history = [record()];
    const view = await page('company');
    await companyRecord(view);
    await chooseExpiry(view, 'Acceptance expiry');
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    await view.findByRole('checkbox', { name: 'Confirm this exact company decision' });
    const query =
      read === 'appointments'
        ? client.getQueryCache().findAll({ queryKey: ['company-appointments'] })[0]
        : client
            .getQueryCache()
            .findAll({ queryKey: ['eligibility-records', 'company'] })
            .find((candidate) => candidate.queryKey.at(-1) === (read === 'detail' ? requestId : company));
    expect(query).toBeTruthy();
    const retained = query!.state.data;
    await act(async () => {
      query!.setState({
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('Synthetic current company read failed'),
      });
    });
    await waitFor(() => expect(view.queryByText('Retained history')).toBeNull());
    expect(view.queryByRole('button', { name: `Open company eligibility request ${requestId}` })).toBeNull();
    expect(view.queryByText(sources[0].declarationText)).toBeNull();
    expect(view.queryByRole('checkbox', { name: 'Confirm this exact company decision' })).toBeNull();
    expect(query!.state.data).toBe(retained);
    await act(async () => {
      await client.refetchQueries({ queryKey: query!.queryKey, exact: true });
    });
    expect(await view.findByText('Retained history')).toBeTruthy();
    expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
  },
);

it.each(['appointments', 'queue', 'detail'] as const)(
  'hides cached company records during a held current %s HTTP read until the actual receipt returns',
  async (read) => {
    history = [record()];
    const view = await page('company');
    await companyRecord(view);
    await chooseExpiry(view, 'Acceptance expiry');
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    await view.findByRole('checkbox', { name: 'Confirm this exact company decision' });
    await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm this exact company decision' }));
    const oldConfirm = pressHandler(view, 'Record company decision');
    const query =
      read === 'appointments'
        ? client.getQueryCache().findAll({ queryKey: ['company-appointments'] })[0]!
        : client
            .getQueryCache()
            .findAll({ queryKey: ['eligibility-records', 'company'] })
            .find((candidate) => candidate.queryKey.at(-1) === (read === 'detail' ? requestId : company))!;
    const retained = query.state.data;
    const url =
      read === 'appointments'
        ? '/api/v1/company-authority/appointments/'
        : read === 'queue'
          ? queueUrl
          : `${queueUrl}${requestId}/`;
    const base = apiClient.defaults.adapter;
    if (typeof base !== 'function') throw new Error('Actual Axios adapter is unavailable');
    let release!: () => void;
    let reached = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === url) {
        reached = true;
        await held;
      }
      return base(config);
    };
    let refreshed!: Promise<void>;
    await act(async () => {
      refreshed = client.refetchQueries({ queryKey: query.queryKey, exact: true });
    });
    await waitFor(() => expect(reached).toBe(true));
    await waitFor(() => expect(view.queryByText('Retained history')).toBeNull());
    expect(view.queryByRole('button', { name: `Open company eligibility request ${requestId}` })).toBeNull();
    expect(view.queryByText(sources[0].declarationText)).toBeNull();
    expect(view.queryByRole('checkbox', { name: 'Confirm this exact company decision' })).toBeNull();
    expect(query.state.data).toBe(retained);
    await act(async () => {
      oldConfirm();
    });
    expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
    await act(async () => {
      release();
      await refreshed;
    });
    expect(await view.findByText('Retained history')).toBeTruthy();
    expect(sent.some((item) => item.url?.endsWith('/decide/'))).toBe(false);
  },
);

it.each(['expired', 'revoked'] as const)(
  'replays the retained dispatched receipt when original approval is %s before the receipt returns',
  async (loss) => {
    history = [record()];
    const reader = { ...appointments[0], uuid: uuid(6), capabilities: ['prepare'] };
    appointments = [...appointments, reader as OwnCompanyAppointment];
    const base = apiClient.defaults.adapter;
    if (typeof base !== 'function') throw new Error('Actual Axios adapter is unavailable');
    let retained: Awaited<ReturnType<typeof base>> | null = null;
    let original: Record<string, unknown> | null = null;
    let created = 0;
    let committed!: () => void;
    let release!: () => void;
    const committedReceipt = new Promise<void>((resolve) => {
      committed = resolve;
    });
    const heldReceipt = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
      if (config.url === `${queueUrl}${requestId}/decide/`) {
        if (retained) {
          sent.push(config);
          expect(input(config)).toEqual(original);
          return { ...retained, config };
        }
        const receipt = await base(config);
        retained = receipt;
        original = input(config);
        created += 1;
        committed();
        await heldReceipt;
        return receipt;
      }
      return base(config);
    };
    const view = await page('company');
    await companyRecord(view);
    await chooseExpiry(view, 'Acceptance expiry');
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    await fireEvent.press(await view.findByRole('checkbox', { name: 'Confirm this exact company decision' }));
    await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
    await committedReceipt;
    expect(created).toBe(1);
    appointments = [
      {
        ...appointments[0],
        isEffective: false,
        ...(loss === 'revoked'
          ? { status: 'revoked', revokedAt: submittedAt }
          : { expiresAt: '2020-01-05T12:00:00.000Z' }),
      },
      appointments[1],
    ];
    await act(async () => {
      client.setQueriesData({ queryKey: ['company-appointments'] }, appointments);
    });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(view.queryByRole('checkbox', { name: 'Confirm this exact company decision' })).toBeNull(),
    );
    await waitFor(() => expect(view.getByRole('button', { name: 'Preview company decision' })).toBeEnabled());
    await fireEvent.press(view.getByRole('button', { name: 'Preview company decision' }));
    await view.findByText(/The outcome is unconfirmed/);
    await fireEvent.press(view.getByRole('checkbox', { name: 'Confirm this exact company decision' }));
    await fireEvent.press(view.getByRole('button', { name: 'Record company decision' }));
    await view.findByText('Company decision');
    const writes = sent.filter((item) => item.url?.endsWith('/decide/'));
    expect(writes).toHaveLength(2);
    expect(input(writes[1])).toEqual(original);
    expect(input(writes[1]).appointment).toBe(appointmentId);
    expect(input(writes[1]).idempotencyKey).toBe(uuid(101));
    expect(input(writes[1]).previewDigest).toBe(digest);
    expect(sent.filter((item) => item.url?.endsWith('/decision-preview/'))).toHaveLength(1);
    expect(created).toBe(1);
  },
);
