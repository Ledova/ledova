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
  type RegisterPauseChange,
  type RegisterPauseChangePreparation,
  type RegisterPauseChangeDecideRequest,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope } from '../../services/sessionScope';
import { pickedFile, resetFiles, files, nativeFileSystem } from '../../testSupport/documentFiles';
import { CompanyPauseFlow } from './CompanyPauseFlow';
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
let records: RegisterPauseChange[];
let failClass: boolean, failHistory: boolean, loseApply: boolean;
let sequence: number;
let prepareAnswer: jest.Mock, fileAnswer: jest.Mock;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}
function pauseFrom(body: RegisterPauseChangePreparation): RegisterPauseChange {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: body.token,
    paused: body.paused,
    reason: body.reason,
    authorityReference: body.authorityReference,
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
  return pauseFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    token: TOKEN,
    paused: true,
    reason: 'Temporary company restriction',
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
function Subject() {
  const data = useTokenDetail(TOKEN);
  return <CompanyPauseFlow uuid={TOKEN} data={data} />;
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
  await view.findByRole('button', { name: 'Prepare pause change' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return view;
}
async function fill(view: Awaited<ReturnType<typeof open>>, paused = true) {
  await fireEvent.press(view.getByRole('button', { name: paused ? 'Request pause' : 'Request unpause' }));
  await fireEvent.changeText(view.getByLabelText('Pause reason'), ' Temporary company restriction ');
  await fireEvent.changeText(view.getByLabelText('Authority reference'), ' BOARD-1 ');
  await fireEvent.press(view.getByRole('button', { name: 'Choose the pause authority document' }));
  await view.findByRole('button', { name: 'Replace the pause authority document' });
}
async function decide(view: Awaited<ReturnType<typeof open>>, kind: 'Approve' | 'Apply' | 'Reject', reason?: string) {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${kind} the company pause change`) }));
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
    if (url === URLS.REGISTER_PAUSE_CHANGES) {
      if (failHistory) throw new Error('Unavailable pause history');
      return page(records.map((row) => structuredClone(row)));
    }
    if (url.endsWith('/file/')) return fileAnswer();
    throw new Error(`Unexpected private GET ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterPauseChangePreparation) => {
    const record = records.find((row) => row.uuid === body.operationId) ?? pauseFrom(body);
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
    if (url === URLS.REGISTER_PAUSE_CHANGES) return prepareAnswer(body);
    const record = records.find(
      (row) =>
        url === URLS.REGISTER_PAUSE_CHANGE_PREVIEW(row.uuid) || url === URLS.REGISTER_PAUSE_CHANGE_DECIDE(row.uuid),
    );
    if (record) {
      const decisionBody = body as RegisterPauseChangeDecideRequest;
      if (url === URLS.REGISTER_PAUSE_CHANGE_PREVIEW(record.uuid))
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
            paused: record.paused,
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
          record.execution = {
            submissionId: record.uuid,
            paused: record.paused!,
            status: 'pending',
            completedAt: null,
            observation: null,
            operationId: null,
            claimId: null,
            operationStatus: null,
            txHash: null,
            blockNumber: null,
            blockHash: null,
            gasUsed: null,
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
  'lets a nonowner ADMIN prepare, approve and apply a company pause change with whole-share on a %s Base class',
  async (status) => {
    classRecord.status = status;
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
    await view.findByText('Prepared pause change');
    expect(prepareAnswer).toHaveBeenCalledWith({
      operationId: expect.any(String),
      appointment: appointment.uuid,
      token: TOKEN,
      paused: true,
      reason: 'Temporary company restriction',
      authorityReference: 'BOARD-1',
      authorityEvidence: expect.any(String),
    });
    await decide(view, 'Approve');
    await view.findByText('Approved pause change');
    expect(records[0]!.execution).toBeNull();
    await decide(view, 'Apply');
    await view.findByText('Original pause change admitted; outcome unresolved');
    expect(classRecord.totalSupply).toBe('1000');
    expect(records[0]!.execution?.status).toBe('pending');
    expect(
      [...get.mock.calls, ...post.mock.calls].every(
        ([url]) => !/wallet|nomination|eligibility|issuance|register-links|register-members/.test(url),
      ),
    ).toBe(true);
    expect(view.queryByText('Finalised original pause transaction projected')).toBeNull();
  },
);
it('lets a read-register-only appointee read private authority copies and history without fresh POST', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  const view = await render(<Subject />, { wrapper });
  await view.findByText('Prepared pause change');
  expect(view.queryByRole('button', { name: 'Prepare pause change' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: /^Download authority document of company pause change/ }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(post).not.toHaveBeenCalled();
});
it.each([
  ['reason', '', 'BOARD-1'],
  ['reason length', 'x'.repeat(1001), 'BOARD-1'],
  ['reference', 'Temporary company restriction', ' '],
  ['reference length', 'Temporary company restriction', 'x'.repeat(256)],
])('refuses invalid %s before fresh file acquisition or evidence', async (_case, reason, reference) => {
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: 'Request pause' }));
  await fireEvent.changeText(view.getByLabelText('Pause reason'), reason);
  await fireEvent.changeText(view.getByLabelText('Authority reference'), reference);
  expect(view.getByRole('button', { name: 'Choose the pause authority document' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Prepare pause change' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  expect(post).not.toHaveBeenCalled();
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
});
it.each([403, 404, 503])(
  'keeps original full-body preparation through %s ambiguity and recovers under current read after class/history loss',
  async (status) => {
    prepareAnswer.mockImplementationOnce(async (body: RegisterPauseChangePreparation) => {
      records = [pauseFrom(body)];
      throw { response: { status } };
    });
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
    await view.findByRole('button', { name: 'Recover original pause preparation receipt' });
    const original = prepareAnswer.mock.calls[0]![0];
    failClass = true;
    failHistory = true;
    appointments = [{ ...appointment, capabilities: ['read_register'] }];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
    });
    await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
    await view.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
    await fireEvent.press(view.getByRole('button', { name: 'Recover original pause preparation receipt' }));
    await waitFor(() =>
      expect(view.queryByRole('button', { name: 'Recover original pause preparation receipt' })).toBeNull(),
    );
    expect(prepareAnswer.mock.calls.map(([body]) => body)).toEqual([original, original]);
    expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
  },
);
it.each([400, 409])('resolves definitive refusal %s without a false original recovery receipt', async (status) => {
  prepareAnswer.mockRejectedValueOnce({ response: { status } });
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await waitFor(() => expect(prepareAnswer).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(view.getByRole('button', { name: 'Prepare pause change' }).props.accessibilityState.disabled).toBe(false),
  );
  expect(view.queryByRole('button', { name: 'Recover original pause preparation receipt' })).toBeNull();
});
it('keeps a populated draft but sends zero fresh authority after exact source read loss, then permits the healthy same-source retry', async () => {
  const view = await open();
  await fill(view);
  failHistory = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
  await view.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await view.findByText('Refresh the exact company pause source before continuing.');
  expect(post).not.toHaveBeenCalled();
  expect(view.getByLabelText('Pause reason').props.value).toBe(' Temporary company restriction ');
  failHistory = false;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
  await waitFor(() =>
    expect(
      view.queryByText('The pause records could not be refreshed. Retained original receipts remain available.'),
    ).toBeNull(),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await view.findByText('Prepared pause change');
  expect(post.mock.calls.map(([url]) => url)).toEqual([URLS.REGISTER_EVIDENCE, URLS.REGISTER_PAUSE_CHANGES]);
});
it.each(['account', 'profile', 'epoch'] as const)(
  'refuses captured native upload/preparation transport after actual %s change',
  async (kind) => {
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
    await view.findByText('Prepared pause change');
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Prepare pause change' }).props.accessibilityState.disabled).toBe(false),
    );
    const sent = post.mock.calls.filter(
      ([url]) => url === URLS.REGISTER_EVIDENCE || url === URLS.REGISTER_PAUSE_CHANGES,
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
it('rechecks the captured class after real native file acquisition before any authority upload', async () => {
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: 'Request pause' }));
  await fireEvent.changeText(view.getByLabelText('Pause reason'), 'Temporary company restriction');
  await fireEvent.changeText(view.getByLabelText('Authority reference'), 'BOARD-1');
  let finish!: (value: Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>) => void;
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Choose the pause authority document' }));
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    classRecord.totalSupply = '1001';
    await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
    finish(pickedFile(1));
  });
  await view.findByText(
    'The captured company, class or exact pause terms changed. Refresh before a new pause decision.',
  );
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  expect(post).not.toHaveBeenCalled();
});
it('keeps the admitted original apply decision through later stage/read loss and recovers one identical request', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await view.findByText('Prepared pause change');
  await decide(view, 'Approve');
  await view.findByText('Approved pause change');
  loseApply = true;
  await decide(view, 'Apply');
  await view.findByRole('button', { name: /^Recover apply receipt for company pause change/ });
  const original = post.mock.calls.find(
    ([url, body]) =>
      url === URLS.REGISTER_PAUSE_CHANGE_DECIDE(records[0]!.uuid) &&
      (body as RegisterPauseChangeDecideRequest).kind === 'apply',
  )!;
  failClass = true;
  failHistory = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-pause-appointments'] });
    await client.refetchQueries({ queryKey: ['company-pause-changes'] });
    await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
  });
  await fireEvent.press(view.getByRole('button', { name: /^Recover apply receipt for company pause change/ }));
  await waitFor(() =>
    expect(view.queryByRole('button', { name: /^Recover apply receipt for company pause change/ })).toBeNull(),
  );
  expect(
    post.mock.calls
      .filter(([url, body]) => url === original[0] && (body as RegisterPauseChangeDecideRequest).kind === 'apply')
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
  await fireEvent.press(view.getByRole('button', { name: /^Download authority document of company pause change/ }));
  await waitFor(() => expect(reply).toBeDefined());
  await act(async () => {
    invalidateSessionScope();
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    reply!({ data: Uint8Array.from([1, 2]).buffer, headers: { 'content-type': 'application/pdf' } });
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect([...files.keys()].some((uri) => uri.includes('pause-authority'))).toBe(false);
  expect(nativeFileSystem.File).toBeDefined();
});
it('exposes only narrow personal company steps and retains a real rejection without an execution', async () => {
  appointments = [{ ...appointment, capabilities: ['prepare'] }];
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await view.findByText('Prepared pause change');
  expect(view.queryByRole('button', { name: /^Approve the company pause change/ })).toBeNull();
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
  await view.findByRole('button', { name: /^Approve the company pause change/ });
  expect(view.queryByRole('button', { name: /^Apply the company pause change/ })).toBeNull();
  await decide(view, 'Reject', 'Documented company refusal');
  await view.findByText('Rejected pause change');
  expect(records[0]!.rejectionReason).toBe('Documented company refusal');
  expect(records[0]!.execution).toBeNull();
});
it('refuses every fresh authority POST when the actual personal appointment expires between refresh ticks, then accepts healthy restoration', async () => {
  const view = await open();
  await fill(view);
  appointments[0]!.expiresAt = '2000-01-01T00:00:00Z';
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  expect(post).not.toHaveBeenCalled();
  appointments[0]!.expiresAt = null;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
  await view.findByRole('button', { name: 'Prepare pause change' });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await view.findByText('Prepared pause change');
});
it('rejects a foreign pause record as a current source and sends no fresh authority or pause POST', async () => {
  records = [{ ...prepared(), company: ID(999) }];
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: 'Request pause' }));
  await fireEvent.changeText(view.getByLabelText('Pause reason'), 'Temporary company restriction');
  await fireEvent.changeText(view.getByLabelText('Authority reference'), 'BOARD-1');
  await view.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
  await fireEvent.press(view.getByRole('button', { name: 'Choose the pause authority document' }));
  await view.findByText('Refresh the exact company pause source before continuing.');
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(view.queryByText('Prepared pause change')).toBeNull();
});
it('retains an explicit unpause direction on an already-unpaused supported class', async () => {
  const view = await open();
  await fill(view, false);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await view.findByText('Prepared pause change');
  expect(records[0]!.paused).toBe(false);
  expect(records[0]!.execution).toBeNull();
  expect(classRecord.status).toBe('deployed');
});
it.each(['observed', 'confirmed'] as const)(
  'preserves the genuine original %s journal separately from later opposite state and failed history',
  async (status) => {
    const view = await open();
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
    await view.findByText('Prepared pause change');
    await decide(view, 'Approve');
    await view.findByText('Approved pause change');
    await decide(view, 'Apply');
    await view.findByText('Original pause change admitted; outcome unresolved');
    classRecord.status = 'paused';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['company-token', TOKEN] });
    });
    expect(view.queryByText('Finalised original pause transaction projected')).toBeNull();
    records[0]!.execution = {
      ...records[0]!.execution!,
      status,
      completedAt: '2026-10-08T00:02:00Z',
      ...(status === 'observed'
        ? { observation: { blockNumber: 7, blockHash: `0x${'4'.repeat(64)}`, observedAt: '2026-10-08T00:01:00Z' } }
        : {
            operationId: ID(170),
            claimId: ID(171),
            operationStatus: 'confirmed',
            txHash: `0x${'3'.repeat(64)}`,
            blockNumber: 7,
            blockHash: `0x${'4'.repeat(64)}`,
            gasUsed: 24000,
          }),
    };
    await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
    const label =
      status === 'observed'
        ? 'Requested state already observed; no transaction, signature or nonce'
        : 'Finalised original pause transaction projected';
    await view.findByText(label);
    classRecord.status = 'deployed';
    failHistory = true;
    await fireEvent.press(view.getByRole('button', { name: 'Refresh company pause records' }));
    await view.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
    expect(view.getByText(label)).toBeTruthy();
    if (status === 'observed') expect(records[0]!.execution?.operationId).toBeNull();
  },
);
it('retains a mismatched preparation as uncertain and replays the original full body', async () => {
  prepareAnswer.mockImplementationOnce(async (body: RegisterPauseChangePreparation) => {
    records = [pauseFrom(body)];
    return { data: { ...records[0], paused: false } };
  });
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: 'Prepare pause change' }));
  await fireEvent.press(await view.findByRole('button', { name: 'Recover original pause preparation receipt' }));
  await view.findByText('Prepared pause change');
  expect(prepareAnswer.mock.calls).toHaveLength(2);
  expect(prepareAnswer.mock.calls[1]![0]).toEqual(prepareAnswer.mock.calls[0]![0]);
  expect(records).toHaveLength(1);
});
