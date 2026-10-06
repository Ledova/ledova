// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  USER_PREFERENCES_QUERY_KEY,
  type CompanyEligibilityRequest,
  type CompanyEligibilitySharedSummary,
  type InvestorClassification,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../company/testSupport';
import ParticipantEligibilityPage from './participant';
import CompanyEligibilityPage from './company';

const sourceUuid = 'a1111111-1111-4111-8111-111111111111';
const companyUuid = 'b1111111-1111-4111-8111-111111111111';
const otherCompany = 'b2222222-2222-4222-8222-222222222222';
const appointmentUuid = 'c1111111-1111-4111-8111-111111111111';
const recordUuid = 'd1111111-1111-4111-8111-111111111111';
const offeringUuid = 'e1111111-1111-4111-8111-111111111111';
const ownUrl = '/api/v1/company-eligibility/requests/';
const companyUrl = `/api/v1/companies/${companyUuid}/eligibility-requests/`;
const appointmentKey = ['company-appointments', 'profile-one', 'account-one'];
const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient;
let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>;
let source: InvestorClassification;
let appointment: OwnCompanyAppointment;
let record: CompanyEligibilityRequest;
let previewSummary: CompanyEligibilitySharedSummary;
let interceptor: number | undefined;
let lostResponse: boolean;
let lostDecisionResponse: boolean;

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, status, statusText: 'OK', headers: {} };
}

function body(config: InternalAxiosRequestConfig) {
  return JSON.parse(config.data || '{}');
}

function writes(suffix: string) {
  return adapter.mock.calls
    .map(([config]) => config)
    .filter((config) => config.method === 'post' && config.url === suffix);
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  prepareCompanyClient(client, 'investor');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  source = {
    uuid: sourceUuid,
    userAccount: 'account-one',
    category: 'professional_investor',
    categoryDisplay: 'Professional investor',
    declarationText: 'Synthetic professional investor declaration.',
    declaredBasis: 'Private financial basis must stay private',
    status: 'submitted',
    statusDisplay: 'Submitted',
    submittedAt: '2026-10-05T01:00:00Z',
    createdAt: '2026-10-05T01:00:00Z',
    expiresAt: null,
    reviewedAt: null,
    rejectionReason: '',
    reviewNotes: 'Private reviewer notes',
    evidenceMimeType: 'application/pdf',
    evidenceFileSize: 100,
    isLive: false,
    isExpired: false,
  };
  appointment = {
    uuid: appointmentUuid,
    company: companyUuid,
    companyName: 'Synthetic issuer',
    source: 'invitation',
    status: 'active',
    isEffective: true,
    capabilities: ['prepare', 'approve'],
    delegatableCapabilities: [],
    createdAt: '2026-10-05T01:00:00Z',
    expiresAt: null,
    revokedAt: null,
    declarationText: null,
    declarationVersion: null,
  };
  previewSummary = {
    category: 'professional_investor',
    declarationText: source.declarationText,
    source: sourceUuid,
    userAccount: 'account-one',
    company: companyUuid,
    submittedAt: source.submittedAt,
    requestedExpiresAt: '2030-01-01T00:00:00.000Z',
  };
  record = {
    uuid: recordUuid,
    userAccount: 'account-one',
    company: companyUuid,
    source: sourceUuid,
    submittedBy: 71,
    idempotencyKey: 'f1111111-1111-4111-8111-111111111111',
    category: 'professional_investor',
    version: '1',
    sharedSummary: previewSummary,
    sourceFingerprint: 'metadata-digest',
    evidenceHash: 'bytes-digest',
    digest: 'request-digest',
    requestedExpiresAt: previewSummary.requestedExpiresAt,
    submittedAt: '2026-10-05T02:00:00Z',
    outcome: 'pending',
    decision: null,
    withdrawal: null,
  };
  lostResponse = false;
  lostDecisionResponse = false;
  adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.method === 'get') {
      if (config.url === '/api/investor-classifications/')
        return response(config, { results: [source], count: 1, next: null });
      if (config.url === '/api/v1/company-authority/appointments/')
        return response(config, { results: [appointment], count: 1, next: null });
      if (config.url === ownUrl || config.url === companyUrl)
        return response(config, { results: [record], count: 1, next: null });
      if (config.url === `${ownUrl}${recordUuid}/` || config.url === `${companyUrl}${recordUuid}/`)
        return response(config, record);
    }
    if (config.method === 'post') {
      const input = body(config);
      if (config.url === `${ownUrl}preview/`) {
        previewSummary = {
          ...previewSummary,
          category: source.category,
          requestedExpiresAt: input.requestedExpiresAt,
          ...(input.company
            ? { company: input.company }
            : {
                offering: input.offering,
                token: 'share-class',
                quantity: input.quantity,
                pricePerShare: '500000.00',
                priceCurrency: 'AUD',
                amountAud: '500000.00',
                offeringTerms: { pricePerShare: '500000.00', quantity: input.quantity, closingDate: '2030-01-01' },
                offeringTermsDigest: 'terms-digest',
              }),
        };
        return response(config, {
          version: '1',
          previewDigest: 'request-preview-digest',
          sharedSummary: previewSummary,
          sourceFingerprint: 'metadata-digest',
          evidenceHash: 'bytes-digest',
          canSubmit: true,
          unmetRequirements: [],
        });
      }
      if (config.url === ownUrl) {
        record = {
          ...record,
          idempotencyKey: input.idempotencyKey,
          sharedSummary: previewSummary,
          source: input.source,
          company: previewSummary.company,
          requestedExpiresAt: input.requestedExpiresAt,
        };
        if (lostResponse) {
          lostResponse = false;
          throw new Error('Synthetic response lost after retained creation');
        }
        return response(config, record, 201);
      }
      if (config.url === `${companyUrl}${recordUuid}/decision-preview/`)
        return response(config, {
          previewDigest: 'decision-preview-digest',
          canDecide: appointment.capabilities.includes('approve'),
          unmetRequirements: appointment.capabilities.includes('approve') ? [] : ['personal_approve_required'],
        });
      if (config.url === `${companyUrl}${recordUuid}/decide/`) {
        record = {
          ...record,
          outcome: input.outcome,
          decision: {
            uuid: 'd2222222-2222-4222-8222-222222222222',
            appointment: input.appointment,
            decidedBy: 72,
            decidedAt: '2026-10-05T03:00:00Z',
            digest: 'decision-digest',
            expiresAt: input.expiresAt ?? null,
            idempotencyKey: input.idempotencyKey,
            outcome: input.outcome,
            reason: input.reason ?? '',
            requestDigest: record.digest,
            revocation: null,
          },
        };
        if (lostDecisionResponse) {
          lostDecisionResponse = false;
          throw new Error('Synthetic company decision response lost');
        }
        return response(config, record);
      }
      if (config.url === `${ownUrl}${recordUuid}/withdraw/`) {
        record = {
          ...record,
          outcome: 'withdrawn',
          withdrawal: {
            uuid: 'd3333333-3333-4333-8333-333333333333',
            withdrawnAt: '2026-10-05T04:00:00Z',
            withdrawnBy: 71,
            digest: 'withdrawal-digest',
            idempotencyKey: input.idempotencyKey,
          },
        };
        return response(config, record);
      }
      if (config.url === `${companyUrl}${recordUuid}/revoke/`) {
        record = {
          ...record,
          outcome: 'revoked',
          decision: {
            ...record.decision!,
            revocation: {
              uuid: 'd4444444-4444-4444-8444-444444444444',
              appointment: input.appointment,
              revokedBy: 72,
              revokedAt: '2026-10-05T04:00:00Z',
              reason: input.reason,
              digest: 'revocation-digest',
              idempotencyKey: input.idempotencyKey,
            },
          },
        };
        return response(config, record);
      }
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  });
  apiClient.defaults.adapter = adapter;
});

afterEach(() => {
  cleanup();
  client.clear();
  if (interceptor !== undefined) apiClient.interceptors.request.eject(interceptor);
  interceptor = undefined;
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

async function requestPreview(product = false) {
  if (product) source = { ...source, category: 'product_value', categoryDisplay: 'Product value' };
  renderCompanyPage(client, <ParticipantEligibilityPage />, 'Your company eligibility');
  fireEvent.change(await screen.findByLabelText('Your evidence source'), { target: { value: sourceUuid } });
  fireEvent.change(screen.getByLabelText(product ? 'Approved offering UUID' : 'Exact company UUID'), {
    target: { value: product ? offeringUuid : companyUuid },
  });
  if (product) fireEvent.change(screen.getByLabelText('Whole-share quantity'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Requested expiry (local date and time)'), {
    target: { value: '2030-01-01T00:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview company eligibility request' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
}

function consent() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to share this exact summary with this company.' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'I accept the declaration shown above.' }));
}

async function companyDetail() {
  renderCompanyPage(client, <CompanyEligibilityPage />, 'Company eligibility');
  fireEvent.change(await screen.findByLabelText('Company'), { target: { value: companyUuid } });
  fireEvent.change(await screen.findByLabelText('Your exact decision appointment'), {
    target: { value: appointmentUuid },
  });
  fireEvent.click(await screen.findByRole('button', { name: `View request ${recordUuid}` }));
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
}

async function decisionPreview(outcome: 'accepted' | 'refused' = 'accepted') {
  await companyDetail();
  if (outcome === 'refused') {
    fireEvent.change(screen.getByLabelText('Decision outcome'), { target: { value: outcome } });
    fireEvent.change(screen.getByLabelText('Refusal reason'), { target: { value: 'Synthetic company refusal.' } });
  } else
    fireEvent.change(screen.getByLabelText('Acceptance expiry (local date and time)'), {
      target: { value: '2029-01-01T00:00' },
    });
  fireEvent.click(screen.getByRole('button', { name: 'Preview company decision' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
}

it('renders the real declaration and strict summary, requiring separate sharing and declaration consent', async () => {
  await requestPreview();
  expect(screen.getByText(source.declarationText)).toBeTruthy();
  expect(screen.queryByText(source.declaredBasis!)).toBeNull();
  expect(screen.queryByText(source.reviewNotes)).toBeNull();
  const submit = screen.getByRole('button', { name: 'Submit company eligibility request' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to share this exact summary with this company.' }));
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'I accept the declaration shown above.' }));
  fireEvent.click(submit);
  fireEvent.click(submit);
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
  expect(writes(ownUrl)).toHaveLength(1);
  expect(body(writes(ownUrl)[0]!)).toMatchObject({
    source: sourceUuid,
    company: companyUuid,
    sharingAccepted: true,
    declarationAccepted: true,
    previewDigest: 'request-preview-digest',
  });
  expect(screen.getByText(/New actions recheck the current decision/)).toBeTruthy();
});

it('previews exact product terms with integer quantity and keeps the derived company out of input', async () => {
  await requestPreview(true);
  expect(body(writes(`${ownUrl}preview/`)[0]!)).toMatchObject({
    source: sourceUuid,
    offering: offeringUuid,
    quantity: 1,
  });
  expect(body(writes(`${ownUrl}preview/`)[0]!)).not.toHaveProperty('company');
  expect(screen.getAllByText('500000.00', { selector: 'span' })).toHaveLength(2);
  expect(screen.getByText(/"closingDate": "2030-01-01"/)).toBeTruthy();
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
  expect(body(writes(ownUrl)[0]!)).toMatchObject({ offering: offeringUuid, quantity: 1 });
});

it('retires a preview and both consents immediately when the exact target changes', async () => {
  await requestPreview();
  consent();
  fireEvent.change(screen.getByLabelText('Exact company UUID'), { target: { value: otherCompany } });
  expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview company eligibility request' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
  expect(
    (screen.getByRole('button', { name: 'Submit company eligibility request' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(writes(ownUrl)).toHaveLength(0);
});

it('reuses the complete original payload and key after a lost creation response', async () => {
  await requestPreview();
  lostResponse = true;
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByText(/previous outcome is uncertain/);
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
  expect(writes(ownUrl)).toHaveLength(2);
  expect(body(writes(ownUrl)[1]!)).toEqual(body(writes(ownUrl)[0]!));
});

it.each(['account', 'target', 'close'] as const)(
  'retires a held request before actual dispatch after %s changes',
  async (change) => {
    await requestPreview();
    consent();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    interceptor = apiClient.interceptors.request.use(async (config) => {
      if (config.url === ownUrl && config.method === 'post') {
        entered = true;
        await hold;
      }
      return config;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
    await waitFor(() => expect(entered).toBe(true));
    if (change === 'account')
      act(() =>
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: {
            ...companyPreferences('investor'),
            userAccount: { ...companyPreferences('investor').userAccount!, uuid: 'account-two' },
          },
        }),
      );
    else if (change === 'target')
      fireEvent.change(screen.getByLabelText('Exact company UUID'), { target: { value: otherCompany } });
    else fireEvent.click(screen.getByRole('button', { name: 'Close confirmation' }));
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull());
    expect(writes(ownUrl)).toHaveLength(0);
  },
);

it('lets a prepare-only investor read the company queue and preview, with personal approval unmet', async () => {
  appointment = { ...appointment, capabilities: ['prepare'], delegatableCapabilities: ['approve'] };
  await decisionPreview();
  expect(screen.getByText('personal_approve_required')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
  expect((screen.getByRole('button', { name: 'Record company decision' }) as HTMLButtonElement).disabled).toBe(true);
  expect(writes(`${companyUrl}${recordUuid}/decide/`)).toHaveLength(0);
  expect(adapter.mock.calls.some(([config]) => config.url === '/api/v1/companies/')).toBe(false);
  expect(adapter.mock.calls.some(([config]) => config.url?.includes('/team/'))).toBe(false);
});

it.each(['accepted', 'refused'] as const)(
  'records the exact %s decision and explicit confirmation with its selected appointment',
  async (outcome) => {
    await decisionPreview(outcome);
    const review = screen.getByRole('heading', { name: 'Review exact action' }).closest('section')!;
    expect(within(review).getByText(outcome)).toBeTruthy();
    if (outcome === 'refused') expect(within(review).getByText(/Synthetic company refusal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record company decision' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull());
    expect(writes(`${companyUrl}${recordUuid}/decide/`)).toHaveLength(1);
    expect(body(writes(`${companyUrl}${recordUuid}/decide/`)[0]!)).toMatchObject({
      outcome,
      appointment: appointmentUuid,
      previewDigest: 'decision-preview-digest',
      confirmation: true,
    });
    if (outcome === 'refused')
      expect(body(writes(`${companyUrl}${recordUuid}/decide/`)[0]!)).not.toHaveProperty('expiresAt');
  },
);

it('retires a held company decision when the actual personal appointment is revoked', async () => {
  await decisionPreview();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  const url = `${companyUrl}${recordUuid}/decide/`;
  interceptor = apiClient.interceptors.request.use(async (config) => {
    if (config.url === url) {
      entered = true;
      await hold;
    }
    return config;
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Record company decision' }));
  await waitFor(() => expect(entered).toBe(true));
  act(() =>
    client.setQueryData(appointmentKey, [
      { ...appointment, status: 'revoked', revokedAt: '2026-10-05T04:00:00Z', isEffective: false },
    ]),
  );
  await act(async () => release());
  expect(writes(url)).toHaveLength(0);
});

it('withdraws a pending own request through an explicit retained confirmation', async () => {
  renderCompanyPage(client, <ParticipantEligibilityPage />, 'Your company eligibility');
  fireEvent.click(await screen.findByRole('button', { name: `View request ${recordUuid}` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare request withdrawal' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact request withdrawal.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw this request' }));
  await screen.findByText('withdrawn');
  expect(writes(`${ownUrl}${recordUuid}/withdraw/`)).toHaveLength(1);
});

it('revokes an acceptance with the exact personal appointment and preserves the reason in history', async () => {
  record = {
    ...record,
    outcome: 'accepted',
    decision: {
      uuid: 'd2222222-2222-4222-8222-222222222222',
      appointment: appointmentUuid,
      decidedBy: 72,
      decidedAt: '2026-10-05T03:00:00Z',
      digest: 'decision-digest',
      expiresAt: '2030-01-01T00:00:00Z',
      idempotencyKey: 'f2222222-2222-4222-8222-222222222222',
      outcome: 'accepted',
      reason: '',
      requestDigest: record.digest,
      revocation: null,
    },
  };
  await companyDetail();
  fireEvent.change(screen.getByLabelText('Revocation reason'), {
    target: { value: 'Synthetic evidence became unavailable.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare acceptance revocation' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact acceptance revocation.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke this acceptance' }));
  await screen.findByText('Synthetic evidence became unavailable.');
  expect(body(writes(`${companyUrl}${recordUuid}/revoke/`)[0]!)).toMatchObject({
    appointment: appointmentUuid,
    reason: 'Synthetic evidence became unavailable.',
  });
});

it('uses retained historically verified evidence for a fresh company request without global authority', async () => {
  source = {
    ...source,
    status: 'verified',
    statusDisplay: 'Verified',
    isLive: false,
    expiresAt: '2031-01-01T00:00:00Z',
  };
  await requestPreview();
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
  expect(writes(ownUrl)).toHaveLength(1);
  expect(adapter.mock.calls.some(([config]) => config.url?.includes('/review/'))).toBe(false);
});

it('retains an identical own request retry after the evidence source is withdrawn', async () => {
  await requestPreview();
  lostResponse = true;
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByText(/previous outcome is uncertain/);
  source = { ...source, status: 'withdrawn', statusDisplay: 'Withdrawn' };
  act(() => client.setQueryData(['eligibility-sources', 'profile-one', 'account-one', 0], [source]));
  expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview company eligibility request' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
  expect(writes(`${ownUrl}preview/`)).toHaveLength(1);
  expect(body(writes(ownUrl)[1]!)).toEqual(body(writes(ownUrl)[0]!));
});

it('retains an uncertain request key across navigation away and back in the same session', async () => {
  await requestPreview();
  lostResponse = true;
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByText(/previous outcome is uncertain/);
  cleanup();
  await requestPreview();
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Submit company eligibility request' }));
  await screen.findByRole('heading', { name: 'Retained request and outcome' });
  expect(writes(`${ownUrl}preview/`)).toHaveLength(1);
  expect(body(writes(ownUrl)[1]!)).toEqual(body(writes(ownUrl)[0]!));
});

it('replays the original decision appointment after expiry through another current prepare read appointment', async () => {
  await decisionPreview();
  lostDecisionResponse = true;
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Record company decision' }));
  await screen.findByText(/previous outcome is uncertain/);
  const original = { ...appointment, expiresAt: '2020-01-01T00:00:00Z', isEffective: false };
  const reader = { ...appointment, uuid: 'c2222222-2222-4222-8222-222222222222', capabilities: ['prepare'] as const };
  act(() => client.setQueryData(appointmentKey, [original, reader]));
  expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview company decision' }));
  await screen.findByRole('heading', { name: 'Review exact action' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Record company decision' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull());
  const url = `${companyUrl}${recordUuid}/decide/`;
  expect(writes(url)).toHaveLength(2);
  expect(body(writes(url)[1]!)).toEqual(body(writes(url)[0]!));
  expect(body(writes(url)[1]!).appointment).toBe(appointmentUuid);
});

it('hides cached records and retires consent when the current account read fails', async () => {
  await requestPreview();
  consent();
  act(() =>
    client
      .getQueryCache()
      .find({ queryKey: USER_PREFERENCES_QUERY_KEY })!
      .setState({ status: 'error', error: new Error('Synthetic account check unavailable') }),
  );
  await screen.findByText('Your signed-in account must be checked before opening these records.');
  expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
  expect(screen.queryByRole('button', { name: `View request ${recordUuid}` })).toBeNull();
  expect(writes(ownUrl)).toHaveLength(0);
});

it.each(['revoked', 'removed', 'scope_removed', 'foreign_only'] as const)(
  'hides the retained company queue, summary, history and review when personal read authority is %s',
  async (loss) => {
    await decisionPreview();
    const cached = client.getQueryData([
      'eligibility-records',
      'company',
      'profile-one',
      'account-one',
      0,
      companyUuid,
      recordUuid,
    ]);
    expect(screen.getByText(source.declarationText)).toBeTruthy();
    const rows =
      loss === 'removed'
        ? []
        : [
            {
              ...appointment,
              ...(loss === 'revoked'
                ? { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T04:00:00Z' }
                : loss === 'scope_removed'
                  ? { capabilities: ['admin'], delegatableCapabilities: ['prepare', 'approve'] }
                  : { company: otherCompany }),
            },
          ];
    act(() => client.setQueryData(appointmentKey, rows));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retained request and outcome' })).toBeNull());
    expect(screen.queryByRole('button', { name: `View request ${recordUuid}` })).toBeNull();
    expect(screen.queryByText(source.declarationText)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
    expect(
      client.getQueryData(['eligibility-records', 'company', 'profile-one', 'account-one', 0, companyUuid, recordUuid]),
    ).toBe(cached);
    await act(async () => client.refetchQueries({ queryKey: appointmentKey }));
    expect(await screen.findByRole('heading', { name: 'Retained request and outcome' })).toBeTruthy();
    expect(screen.getByText(source.declarationText)).toBeTruthy();
    expect(writes(`${companyUrl}${recordUuid}/decide/`)).toHaveLength(0);
  },
);

it('hides cached company records at the actual appointment expiry without another server or cache event', async () => {
  await companyDetail();
  const expiresAt = new Date(Date.now() + 300).toISOString();
  act(() => client.setQueryData(appointmentKey, [{ ...appointment, expiresAt }]));
  expect(screen.getByText(source.declarationText)).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retained request and outcome' })).toBeNull(), {
    timeout: 2000,
  });
  expect(screen.queryByRole('button', { name: `View request ${recordUuid}` })).toBeNull();
  expect(screen.queryByText(source.declarationText)).toBeNull();
  expect(writes(`${companyUrl}${recordUuid}/decide/`)).toHaveLength(0);
});

it.each(['appointments', 'queue', 'detail'] as const)(
  'hides cached queue and selected summary after the current %s read fails, then restores only after a successful read',
  async (read) => {
    await decisionPreview();
    const key =
      read === 'appointments'
        ? appointmentKey
        : [
            'eligibility-records',
            'company',
            'profile-one',
            'account-one',
            0,
            companyUuid,
            ...(read === 'detail' ? [recordUuid] : []),
          ];
    const query = client.getQueryCache().find({ queryKey: key, exact: true })!;
    const retained = query.state.data;
    act(() =>
      query.setState({ status: 'error', error: new Error('Synthetic current read failed'), fetchStatus: 'idle' }),
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retained request and outcome' })).toBeNull());
    expect(screen.queryByRole('button', { name: `View request ${recordUuid}` })).toBeNull();
    expect(screen.queryByText(source.declarationText)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
    expect(query.state.data).toBe(retained);
    await act(async () => client.refetchQueries({ queryKey: key, exact: true }));
    expect(await screen.findByRole('heading', { name: 'Retained request and outcome' })).toBeTruthy();
    expect(writes(`${companyUrl}${recordUuid}/decide/`)).toHaveLength(0);
  },
);

it.each(['appointments', 'queue', 'detail'] as const)(
  'hides cached company records while its current %s HTTP read is held, restoring them only after delivery',
  async (read) => {
    await decisionPreview();
    const url =
      read === 'appointments'
        ? '/api/v1/company-authority/appointments/'
        : read === 'queue'
          ? companyUrl
          : `${companyUrl}${recordUuid}/`;
    const key =
      read === 'appointments'
        ? appointmentKey
        : [
            'eligibility-records',
            'company',
            'profile-one',
            'account-one',
            0,
            companyUuid,
            ...(read === 'detail' ? [recordUuid] : []),
          ];
    const retained = client.getQueryData(key);
    const base = adapter.getMockImplementation()!;
    let release!: () => void;
    let reached = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.mockImplementation(async (config) => {
      if (config.method === 'get' && config.url === url) {
        reached = true;
        await held;
      }
      return base(config);
    });
    let refreshed!: Promise<void>;
    act(() => {
      refreshed = client.refetchQueries({ queryKey: key, exact: true });
    });
    await waitFor(() => expect(reached).toBe(true));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retained request and outcome' })).toBeNull());
    expect(screen.queryByRole('button', { name: `View request ${recordUuid}` })).toBeNull();
    expect(screen.queryByText(source.declarationText)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull();
    expect(client.getQueryData(key)).toBe(retained);
    await act(async () => {
      release();
      await refreshed;
    });
    expect(await screen.findByRole('heading', { name: 'Retained request and outcome' })).toBeTruthy();
    expect(writes(`${companyUrl}${recordUuid}/decide/`)).toHaveLength(0);
  },
);

it.each(['expired', 'revoked'] as const)(
  'recovers a dispatched retained decision receipt after its original appointment is %s before delivery',
  async (loss) => {
    const reader = { ...appointment, uuid: 'c2222222-2222-4222-8222-222222222222', capabilities: ['prepare'] };
    const base = adapter.getMockImplementation()!;
    let receipt: CompanyEligibilityRequest | null = null;
    let committedPayload: unknown;
    let created = 0;
    const url = `${companyUrl}${recordUuid}/decide/`;
    adapter.mockImplementation(async (config) => {
      if (config.method === 'post' && config.url === url) {
        if (receipt) {
          expect(body(config)).toEqual(committedPayload);
          return response(config, receipt);
        }
        const result = await base(config);
        receipt = result.data as CompanyEligibilityRequest;
        committedPayload = body(config);
        created += 1;
        act(() =>
          client.setQueryData(appointmentKey, [
            {
              ...appointment,
              isEffective: false,
              ...(loss === 'expired'
                ? { expiresAt: '2020-01-01T00:00:00Z' }
                : { status: 'revoked', revokedAt: '2026-10-05T04:00:00Z' }),
            },
            reader,
          ]),
        );
        return result;
      }
      return base(config);
    });
    await decisionPreview();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record company decision' }));
    await waitFor(() => expect(created).toBe(1));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull());
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Preview company decision' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview company decision' }));
    await screen.findByText(/previous outcome is uncertain/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this exact company decision.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record company decision' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review exact action' })).toBeNull());
    expect(writes(url)).toHaveLength(2);
    expect(body(writes(url)[1]!)).toEqual(body(writes(url)[0]!));
    expect(body(writes(url)[1]!).appointment).toBe(appointmentUuid);
    expect(writes(`${companyUrl}${recordUuid}/decision-preview/`)).toHaveLength(1);
    expect(created).toBe(1);
    expect(screen.getAllByText('accepted', { selector: 'dd' })).toHaveLength(2);
  },
);
