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
  type RegisterPauseChange,
  type RegisterPauseChangePreparation,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyPauseFlow } from './CompanyPauseFlow';
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
const page = (results: unknown[]) => ({ results, count: results.length, next: null, previous: null });
const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient;
let requests: InternalAxiosRequestConfig[];
let classRecord: typeof token;
let appointments: OwnCompanyAppointment[];
let records: RegisterPauseChange[];
let failClass: boolean, failHistory: boolean, losePrepare: boolean, loseApply: boolean, csrfAccountChange: boolean;
let prepareStatus: number, sequence: number;
let delayFile: boolean, replyFile: (() => void) | null;
function pauseFrom(body: RegisterPauseChangePreparation): RegisterPauseChange {
  const entity = body.token === TOKEN ? token : { ...token, contractAddress: `0x${'9'.repeat(40)}` };
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
        uuid: body.token,
        name: entity.name,
        symbol: entity.symbol,
        chain: 'base',
        contractAddress: entity.contractAddress,
        authorisedShares: '1000',
        decimals: 0,
      },
      transaction: {
        chainId: 84532,
        sender: `0x${'6'.repeat(40)}`,
        to: entity.contractAddress,
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
  return <CompanyPauseFlow uuid={uuid} data={data} />;
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
async function fill(paused = true) {
  await screen.findByRole('button', { name: 'Prepare pause change' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  fireEvent.change(screen.getByLabelText('Requested state'), { target: { value: paused ? 'paused' : 'unpaused' } });
  fireEvent.change(screen.getByLabelText('Pause reason'), { target: { value: ' Temporary company restriction ' } });
  fireEvent.change(screen.getByLabelText('Authority reference'), { target: { value: ' BOARD-1 ' } });
  fireEvent.change(screen.getByLabelText('Pause authority document'), {
    target: { files: [new File(['authority'], 'authority.pdf', { type: 'application/pdf' })] },
  });
}
async function decide(kind: 'Approve' | 'Apply' | 'Reject', reason?: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${kind} \\(pause `) }));
  const dialog = await screen.findByRole('dialog');
  if (reason) {
    fireEvent.change(within(dialog).getByLabelText('Reason for rejection'), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview the rejection' }));
  }
  const confirm = await within(dialog).findByRole('button', { name: `${kind} pause change` });
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
      if (url === URLS.REGISTER_PAUSE_CHANGES) {
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
    if (url === URLS.REGISTER_PAUSE_CHANGES) {
      if (csrfAccountChange) return refuse(config, 403, { detail: 'CSRF Failed: synthetic stale cookie' });
      if (prepareStatus === 400 || prepareStatus === 409) {
        const status = prepareStatus;
        prepareStatus = 0;
        return refuse(config, status, {});
      }
      const record = records.find((row) => row.uuid === body.operationId) ?? pauseFrom(body);
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
      (row) =>
        url === URLS.REGISTER_PAUSE_CHANGE_PREVIEW(row.uuid) || url === URLS.REGISTER_PAUSE_CHANGE_DECIDE(row.uuid),
    );
    if (record) {
      if (url === URLS.REGISTER_PAUSE_CHANGE_PREVIEW(record.uuid))
        return response(config, {
          previewDigest: DIGEST,
          unmetRequirements: [],
          canDecide: true,
          snapshot: record.snapshot,
          intentDigest: record.intentDigest,
          approvalDecision:
            body.kind === 'apply' ? (record.decisions.find((row) => row.kind === 'approve')?.uuid ?? null) : null,
          paused: record.paused,
          reason: record.reason,
          authorityReference: record.authorityReference,
        });
      if (!record.decisions.some((row) => row.idempotencyKey === body.idempotencyKey)) {
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
        record.decisions.push(decision);
        record.stage = body.kind === 'approve' ? 'approved' : body.kind === 'apply' ? 'applied' : 'rejected';
        if (body.kind !== 'approve') {
          record.status = body.kind === 'apply' ? 'applied' : 'rejected';
          record.reviewedAt = decision.decidedAt;
        }
        if (body.kind === 'apply') {
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

it.each(['deployed', 'paused'])(
  'lets a nonowner ADMIN prepare, approve and apply a company pause change with whole-share on a %s Base class',
  async (status) => {
    classRecord.status = status;
    show();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
    await screen.findByText('Prepared pause change');
    const body = JSON.parse(
      requests.find((row) => row.url === URLS.REGISTER_PAUSE_CHANGES && row.method === 'post')!.data as string,
    );
    expect(body).toEqual({
      operationId: expect.any(String),
      appointment: appointment.uuid,
      token: TOKEN,
      paused: true,
      reason: 'Temporary company restriction',
      authorityReference: 'BOARD-1',
      authorityEvidence: expect.any(String),
    });
    await decide('Approve');
    await screen.findByText('Approved pause change');
    expect(records[0].execution).toBeNull();
    await decide('Apply');
    await screen.findByText('Original pause change admitted; outcome unresolved');
    expect(classRecord.totalSupply).toBe('1000');
    expect(records[0].execution?.status).toBe('pending');
    expect(
      requests.every(
        (row) =>
          !/wallet|nomination|eligibility|issuance|register-links|register-members|capital-increases\/.*submit/.test(
            row.url ?? '',
          ),
      ),
    ).toBe(true);
    expect(screen.queryByText('Finalised original pause transaction projected')).toBeNull();
  },
);
it('permits read-register-only pause facts and private authority copies with zero POST', async () => {
  records = [prepared()];
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  show();
  await screen.findByText('Prepared pause change');
  expect(screen.queryByRole('button', { name: 'Prepare pause change' })).toBeNull();
  const create = vi.fn(() => 'blob:pause');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: /^Download pause authority/ }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(requests.every((row) => row.method === 'get')).toBe(true);
});
it.each([
  ['reason', '', 'BOARD-1'],
  ['reason length', 'x'.repeat(1001), 'BOARD-1'],
  ['reference', 'Temporary company restriction', ' '],
  ['reference length', 'Temporary company restriction', 'x'.repeat(256)],
])('refuses invalid %s before fresh evidence', async (_case, reason, reference) => {
  show();
  await fill();
  fireEvent.change(screen.getByLabelText('Pause reason'), { target: { value: reason } });
  fireEvent.change(screen.getByLabelText('Authority reference'), { target: { value: reference } });
  expect(screen.getByRole('button', { name: 'Prepare pause change' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
});
it.each([403, 404, 503])(
  'keeps the exact original preparation after %s ambiguity and recovers with current read access after source loss',
  async (status) => {
    prepareStatus = status;
    show();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
    await screen.findByRole('button', { name: 'Recover original pause preparation receipt' });
    const original = requests.find((row) => row.url === URLS.REGISTER_PAUSE_CHANGES && row.method === 'post')!.data;
    failClass = true;
    failHistory = true;
    appointments = [{ ...appointment, capabilities: ['read_register'] }];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['token', TOKEN] });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
    await screen.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
    fireEvent.click(await screen.findByRole('button', { name: 'Recover original pause preparation receipt' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Recover original pause preparation receipt' })).toBeNull(),
    );
    expect(
      requests.filter((row) => row.url === URLS.REGISTER_PAUSE_CHANGES && row.method === 'post').map((row) => row.data),
    ).toEqual([original, original]);
    expect(requests.filter((row) => row.url === URLS.REGISTER_EVIDENCE)).toHaveLength(1);
  },
);
it.each([400, 409])(
  'treats definitive preparation refusal %s as resolved without an original recovery action',
  async (status) => {
    prepareStatus = status;
    show();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
    await screen.findByText('Synthetic request refused');
    expect(screen.queryByRole('button', { name: 'Recover original pause preparation receipt' })).toBeNull();
  },
);
it('uploads no fresh authority after a populated exact source fails refresh, then retries the retained draft on a healthy source', async () => {
  show();
  await fill();
  failHistory = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Refresh the exact company pause source before continuing.');
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
  expect((screen.getByLabelText('Pause reason') as HTMLTextAreaElement).value).toBe(' Temporary company restriction ');
  failHistory = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await waitFor(() =>
    expect(
      screen.queryByText('The pause records could not be refreshed. Retained original receipts remain available.'),
    ).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Prepared pause change');
  const sent = requests.filter((row) => row.method === 'post');
  expect(sent.map((row) => row.url)).toEqual([URLS.REGISTER_EVIDENCE, URLS.REGISTER_PAUSE_CHANGES]);
  classRecord.totalSupply = '1001';
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
  });
  for (const config of sent)
    expect(() => config.ledovaSubmissionGuard!()).toThrow('The captured company, class or exact pause terms changed');
});
it('refuses a delayed CSRF redispatch under a changed actual account and retains the original receipt', async () => {
  csrfAccountChange = true;
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await waitFor(() => expect(requests.some((row) => row.url === AUTH_ENDPOINTS.VERIFY)).toBe(true));
  expect(requests.filter((row) => row.url === URLS.REGISTER_PAUSE_CHANGES && row.method === 'post')).toHaveLength(1);
});
it('recovers the original admitted apply decision after class/history loss with its unchanged body/key and one execution', async () => {
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Prepared pause change');
  await decide('Approve');
  await screen.findByText('Approved pause change');
  loseApply = true;
  await decide('Apply');
  await screen.findByRole('button', { name: 'Recover original decision receipt' });
  const original = requests.find(
    (row) =>
      row.url === URLS.REGISTER_PAUSE_CHANGE_DECIDE(records[0].uuid) && JSON.parse(row.data as string).kind === 'apply',
  )!;
  failClass = true;
  failHistory = true;
  appointments = [{ ...appointment, capabilities: ['read_register'] }];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-pause-appointments'] });
    await client.refetchQueries({ queryKey: ['company-pause-changes'] });
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original decision receipt' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    requests
      .filter((row) => row.url === original.url && JSON.parse(row.data as string).kind === 'apply')
      .map((row) => row.data),
  ).toEqual([original.data, original.data]);
  expect(records[0].decisions.filter((row) => row.kind === 'apply')).toHaveLength(1);
});
it('retains the latest genuine original transaction projection after a later failed history read without matching-state inference', async () => {
  const record = prepared();
  records = [record];
  show();
  await screen.findByText('Prepared pause change');
  await decide('Approve');
  await screen.findByText('Approved pause change');
  await decide('Apply');
  await screen.findByText('Original pause change admitted; outcome unresolved');
  classRecord.status = 'paused';
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['token', TOKEN] });
  });
  expect(screen.queryByText('Finalised original pause transaction projected')).toBeNull();
  records[0].execution = {
    ...records[0].execution!,
    status: 'confirmed',
    operationId: ID(170),
    claimId: ID(171),
    operationStatus: 'confirmed',
    txHash: `0x${'3'.repeat(64)}`,
    blockNumber: 7,
    blockHash: `0x${'4'.repeat(64)}`,
    gasUsed: 24000,
    completedAt: '2026-10-08T00:02:00Z',
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByText('Finalised original pause transaction projected');
  failHistory = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
  expect(screen.getByText('Finalised original pause transaction projected')).toBeTruthy();
});
it('saves no delayed private pause copy after the actual account changes', async () => {
  records = [prepared()];
  show();
  await screen.findByText('Prepared pause change');
  delayFile = true;
  const create = vi.fn(() => 'blob:pause');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: /^Download pause authority/ }));
  await waitFor(() => expect(replyFile).not.toBeNull());
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
    });
  });
  await act(async () => {
    replyFile!();
  });
  expect(create).not.toHaveBeenCalled();
});
it('uses only personal narrow steps and preserves genuine rejection history without admitting execution', async () => {
  appointments = [{ ...appointment, capabilities: ['prepare'] }];
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Prepared pause change');
  expect(screen.queryByRole('button', { name: /^Approve \(pause/ })).toBeNull();
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByRole('button', { name: /^Approve \(pause/ });
  expect(screen.queryByRole('button', { name: /^Apply \(pause/ })).toBeNull();
  await decide('Reject', 'Documented company refusal');
  await screen.findByText('Rejected pause change');
  expect(records[0].rejectionReason).toBe('Documented company refusal');
  expect(records[0].execution).toBeNull();
});
it('refuses fresh authority synchronously when the current personal appointment expires before its clock tick, then accepts its healthy restoration', async () => {
  show();
  await fill();
  appointments[0].expiresAt = '2000-01-01T00:00:00Z';
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
  appointments[0].expiresAt = null;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByRole('button', { name: 'Prepare pause change' });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Prepared pause change');
});
it('refuses a foreign class/company record instead of caching it as a usable pause source', async () => {
  records = [{ ...prepared(), company: ID(999) }];
  show();
  await fill();
  await screen.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Refresh the exact company pause source before continuing.');
  expect(requests.filter((row) => row.method === 'post')).toHaveLength(0);
  expect(screen.queryByText('Prepared pause change')).toBeNull();
});
it('keeps an explicit unpause request even when the current class is already unpaused', async () => {
  show();
  await fill(false);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByText('Prepared pause change');
  expect(records[0].paused).toBe(false);
  expect(records[0].execution).toBeNull();
  expect(classRecord.status).toBe('deployed');
});
it('shows the genuine original observation without transaction and preserves it after a later opposite class state/read failure', async () => {
  records = [prepared()];
  show();
  await screen.findByText('Prepared pause change');
  await decide('Approve');
  await screen.findByText('Approved pause change');
  await decide('Apply');
  await screen.findByText('Original pause change admitted; outcome unresolved');
  records[0].execution = {
    ...records[0].execution!,
    status: 'observed',
    completedAt: '2026-10-08T00:02:00Z',
    observation: { blockNumber: 7, blockHash: `0x${'4'.repeat(64)}`, observedAt: '2026-10-08T00:01:00Z' },
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByText('Requested state already observed; no transaction, signature or nonce');
  expect(screen.queryByText('Finalised original pause transaction projected')).toBeNull();
  classRecord.status = 'deployed';
  failHistory = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company pause records' }));
  await screen.findByText('The pause records could not be refreshed. Retained original receipts remain available.');
  expect(screen.getByText('Requested state already observed; no transaction, signature or nonce')).toBeTruthy();
  expect(records[0].execution?.operationId).toBeNull();
});
it('retains a mismatched preparation response as uncertain and recovers the exact original body', async () => {
  const adapter = apiClient.defaults.adapter as (config: InternalAxiosRequestConfig) => Promise<unknown>;
  let wrong = true;
  apiClient.defaults.adapter = async (config) => {
    const answer = (await adapter(config)) as ReturnType<typeof response>;
    if (wrong && config.method === 'post' && config.url === URLS.REGISTER_PAUSE_CHANGES) {
      wrong = false;
      return { ...answer, data: { ...(answer.data as object), paused: false } };
    }
    return answer;
  };
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recover original pause preparation receipt' }));
  await screen.findByText('Prepared pause change');
  const bodies = requests
    .filter((row) => row.method === 'post' && row.url === URLS.REGISTER_PAUSE_CHANGES)
    .map((row) => row.data);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(records).toHaveLength(1);
});

it('keeps the original class receipt private when the same component navigates to another class in the same company', async () => {
  losePrepare = true;
  const view = show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await screen.findByRole('button', { name: 'Recover original pause preparation receipt' });
  const original = records[0],
    other = ID(999);
  const adapter = apiClient.defaults.adapter as (config: InternalAxiosRequestConfig) => Promise<unknown>;
  apiClient.defaults.adapter = async (config) => {
    if (config.method === 'get' && config.url === URLS.DETAIL(other))
      return response(config, { ...classRecord, uuid: other, contractAddress: `0x${'9'.repeat(40)}` });
    if (config.method === 'get' && config.url === URLS.HOLDERS(other))
      return response(config, {
        token: { ...classRecord, uuid: other, contractAddress: `0x${'9'.repeat(40)}` },
        initialized: true,
        holders: [],
        issuedSupply: '0',
        waitingEffects: 0,
        totalHolders: 0,
        formerMembers: [],
      });
    if (config.method === 'get' && config.url === URLS.REGISTER_PAUSE_CHANGES && config.params?.token === other)
      return response(config, page(records.filter((row) => row.token === other)));
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
  expect(screen.queryByRole('button', { name: 'Recover original pause preparation receipt' })).toBeNull();
  expect(screen.queryByText(original.uuid)).toBeNull();
  await fill(false);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare pause change' }));
  await waitFor(() =>
    expect(requests.filter((row) => row.method === 'post' && row.url === URLS.REGISTER_PAUSE_CHANGES)).toHaveLength(2),
  );
  const posted = requests
    .filter((row) => row.method === 'post' && row.url === URLS.REGISTER_PAUSE_CHANGES)
    .map((row) => JSON.parse(row.data as string));
  expect(posted[0].token).toBe(TOKEN);
  expect(posted[1].token).toBe(other);
  expect(posted[1].operationId).not.toBe(posted[0].operationId);
});
