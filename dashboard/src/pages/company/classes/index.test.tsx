// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS,
  type CompanyShareToken,
  type TokenHoldersResponse,
  REGISTER_DEPLOYMENT_COPY as COPY,
  type RegisterDeployment,
  type RegisterDeploymentPreparation,
  type RegisterDeploymentDecideRequest,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { ShareClass } from '.';
import { prepareCompanyClient, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('../components/TokenPauseControls', () => ({ TokenPauseControls: () => <p>Existing pause controls</p> }));
let client: QueryClient;
let token: CompanyShareToken;
let register: TokenHoldersResponse;
let failed: string | null;
let deployments: RegisterDeployment[];
let appointments: OwnCompanyAppointment[];
const EMPTY = { results: [], count: 0, next: null, previous: null };
const CLASS = COMPANY_TOKEN_ENDPOINTS.DETAIL('class-one');
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('class-one');
const ISSUANCES = COMPANY_TOKEN_ENDPOINTS.ISSUANCES('class-one');
const REQUESTS = COMPANY_TOKEN_ENDPOINTS.ISSUANCE_REQUESTS;
const CAPITAL = COMPANY_TOKEN_ENDPOINTS.CAPITAL_INCREASES;
const EXPORT = COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT('class-one');

function show() {
  return renderCompanyPage(client, <ShareClass uuid="class-one" />, 'Share class');
}

async function openRaise() {
  fireEvent.click(await screen.findByRole('button', { name: 'Raise authorised shares' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Purpose'), { target: { value: 'Fictional expansion' } });
  fireEvent.change(within(dialog).getByLabelText('Board resolution reference'), {
    target: { value: 'EXAMPLE-2026-1' },
  });
  return dialog;
}

beforeEach(() => {
  vi.resetAllMocks();
  failed = null;
  deployments = [];
  appointments = [];
  token = {
    uuid: 'class-one',
    isOwner: true,
    company: 'company-one',
    companyUuid: 'company-one',
    companyName: 'Harbour Example Pty Ltd',
    name: 'Ordinary shares',
    symbol: 'ORD',
    status: 'deployed',
    statusDisplay: 'Deployed',
    totalSupply: '1000',
    tokenType: 'ordinary',
    tokenTypeDisplay: 'Ordinary',
    chain: 'base',
    contractAddress: '0x' + '1'.repeat(40),
    deploymentTxHash: '0x' + '2'.repeat(64),
    decimals: 0,
    isDivisible: false,
    isTransferable: true,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    deployedAt: null,
  };
  register = {
    token: {
      uuid: token.uuid,
      name: token.name,
      status: token.status,
      symbol: token.symbol,
      totalSupply: token.totalSupply,
    },
    initialized: true,
    issuedSupply: '100',
    waitingEffects: 0,
    holders: [],
    totalHolders: 0,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === CLASS) return { data: { ...token } };
    if (url === HOLDERS) return { data: register };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENTS) return { data: { ...EMPTY, results: deployments } };
    if (url === '/api/v1/company-authority/appointments/') return { data: { ...EMPTY, results: appointments } };
    if (url === EXPORT) return { data: new Blob(['Synthetic register'], { type: 'text/csv' }) };
    return { data: EMPTY };
  });
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows exact issued and authorised counts above the safe integer limit', async () => {
  token.totalSupply = '9007199254740999';
  register = {
    ...register,
    token: { ...register.token, totalSupply: token.totalSupply },
    issuedSupply: '9007199254740993',
  };
  show();
  await screen.findByText('Ordinary shares');
  expect((await screen.findAllByText('9,007,199,254,740,993')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('9,007,199,254,740,999').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Back to Register' }));
  expect(await screen.findByText('Register page')).toBeTruthy();
});

it.each(['draft', 'deploying', 'deployed', 'paused'] as const)(
  'offers only the current %s class actions',
  async (status) => {
    token.status = status;
    token.statusDisplay = status;
    show();
    await screen.findByText('Ordinary shares');
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(!!screen.queryByRole('button', { name: 'Request issuance' })).toBe(status === 'deployed');
    expect(!!screen.queryByRole('button', { name: 'Raise authorised shares' })).toBe(status === 'deployed');
    expect(!!screen.queryByText('Existing pause controls')).toBe(status === 'deployed' || status === 'paused');
    expect(screen.queryByRole('button', { name: 'Deploy class' })).toBeNull();
  },
);

it.each([
  [HOLDERS, 'register'],
  [ISSUANCES, 'issuances'],
  [REQUESTS, 'issuance requests'],
  [CAPITAL, 'authorised share requests'],
] as const)('makes %s failure explicit and retryable', async (endpoint, label) => {
  failed = endpoint;
  show();
  expect(await screen.findByText(`We couldn't load ${label}.`)).toBeTruthy();
  if (endpoint === HOLDERS)
    expect((screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement).disabled).toBe(true);
  failed = null;
  fireEvent.click(screen.getByRole('button', { name: `Retry ${label}` }));
  await waitFor(() => expect(screen.queryByText(`We couldn't load ${label}.`)).toBeNull());
});

it('shows an unavailable class without querying its histories or offering mutation controls', async () => {
  failed = CLASS;
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Ordinary shares')).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(ISSUANCES);
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(CAPITAL);
  expect(screen.queryByRole('button', { name: 'Request issuance' })).toBeNull();
});

it('hides a stale class and its actions after its read starts failing', async () => {
  show();
  await screen.findByText('Ordinary shares');
  failed = CLASS;
  await act(async () =>
    client.invalidateQueries({ queryKey: ['token', 'class-one', 'profile-one', 'account-one'], exact: true }),
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Ordinary shares')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Raise authorised shares' })).toBeNull();
});

it.each(['issue', 'raise'] as const)(
  'preserves the open %s form during a failed class refresh and retries safely',
  async (form) => {
    show();
    let dialog: HTMLElement;
    if (form === 'raise') {
      dialog = await openRaise();
      fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '2' } });
    } else {
      fireEvent.click(await screen.findByRole('button', { name: 'Request issuance' }));
      dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Recipient address'), {
        target: { value: '0x' + '3'.repeat(40) },
      });
      fireEvent.change(within(dialog).getByLabelText('Shares to issue'), { target: { value: '2' } });
      fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Keep this draft' } });
    }
    const confirm = form === 'raise' ? 'Create request' : 'Submit issuance request';
    expect((within(dialog).getByRole('button', { name: confirm }) as HTMLButtonElement).disabled).toBe(false);
    failed = CLASS;
    await act(async () =>
      client.invalidateQueries({ queryKey: ['token', 'class-one', 'profile-one', 'account-one'], exact: true }),
    );
    await waitFor(() => expect(screen.queryByText('Ordinary shares')).toBeNull());
    dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('button', { name: confirm }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
    expect(api.post).not.toHaveBeenCalled();
    const label = form === 'raise' ? 'Purpose' : 'Reason (optional)';
    const value = form === 'raise' ? 'Fictional expansion' : 'Keep this draft';
    expect((within(dialog).getByLabelText(label) as HTMLInputElement).value).toBe(value);
    failed = null;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry class state' }));
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: confirm }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect((within(dialog).getByLabelText(label) as HTMLInputElement).value).toBe(value);
    fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  },
);

it.each(['2147483646', '2147483647', '2147483648'])(
  'validates issuance quantity %s at the supported boundary',
  async (amount) => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Request issuance' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Recipient address'), { target: { value: '0x' + '3'.repeat(40) } });
    fireEvent.change(within(dialog).getByLabelText('Shares to issue'), { target: { value: amount } });
    const submit = within(dialog).getByRole('button', { name: 'Submit issuance request' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(amount === '2147483648');
    fireEvent.click(submit);
    if (amount === '2147483648') expect(api.post).not.toHaveBeenCalled();
    else
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          COMPANY_TOKEN_ENDPOINTS.ISSUE('class-one'),
          {
            recipient: '0x' + '3'.repeat(40),
            amount: Number(amount),
            reason: undefined,
          },
          expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
        ),
      );
  },
);

it.each([
  ['1', true],
  ['2', false],
] as const)(
  'calculates an authorised raise of %s without exceeding the existing total limit',
  async (additional, allowed) => {
    token.totalSupply = '2147483646';
    show();
    const dialog = await openRaise();
    fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: additional } });
    const submit = within(dialog).getByRole('button', { name: 'Create request' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(!allowed);
    fireEvent.click(submit);
    if (!allowed) expect(api.post).not.toHaveBeenCalled();
    else
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          CAPITAL,
          {
            token: 'class-one',
            additionalShares: 1,
            newAuthorizedTotal: 2147483647,
            purpose: 'Fictional expansion',
            boardResolutionReference: 'EXAMPLE-2026-1',
            shareholderApprovalReference: undefined,
          },
          expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
        ),
      );
  },
);

it('shows a huge existing supply and computed raise exactly but sends no unsupported request', async () => {
  token.totalSupply = '9007199254740993';
  show();
  const dialog = await openRaise();
  fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '2' } });
  expect(within(dialog).getByText('Current authorised shares: 9,007,199,254,740,993')).toBeTruthy();
  expect(within(dialog).getByText('New authorised total: 9,007,199,254,740,995')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create request' }));
  expect(api.post).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert')).toBeTruthy();
});

it('retains the raise form and its error after a refused request', async () => {
  api.post.mockRejectedValue(new Error('Refused'));
  show();
  const dialog = await openRaise();
  fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '10' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create request' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect((within(dialog).getByLabelText('Additional shares') as HTMLInputElement).value).toBe('10');
  expect((within(dialog).getByLabelText('Board resolution reference') as HTMLInputElement).value).toBe(
    'EXAMPLE-2026-1',
  );
});

it('stops a prepared raise when a refresh says the class is paused', async () => {
  show();
  const dialog = await openRaise();
  fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '10' } });
  token.status = 'paused';
  await act(async () =>
    client.invalidateQueries({ queryKey: ['token', 'class-one', 'profile-one', 'account-one'], exact: true }),
  );
  await waitFor(() =>
    expect((within(dialog).getByRole('button', { name: 'Create request' }) as HTMLButtonElement).disabled).toBe(true),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create request' }));
  expect(api.post).not.toHaveBeenCalled();
});

it.each(['issue', 'raise'] as const)(
  'keeps a pending %s request open through Escape and outside clicks, then retains a refusal for retry',
  async (form) => {
    let rejectRequest: (error: Error) => void = () => {};
    api.post.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    show();
    let dialog: HTMLElement;
    if (form === 'raise') {
      dialog = await openRaise();
      fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '2' } });
    } else {
      fireEvent.click(await screen.findByRole('button', { name: 'Request issuance' }));
      dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Recipient address'), {
        target: { value: '0x' + '3'.repeat(40) },
      });
      fireEvent.change(within(dialog).getByLabelText('Shares to issue'), { target: { value: '2' } });
    }
    const confirm = form === 'raise' ? 'Create request' : 'Submit issuance request';
    fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await within(dialog).findByRole('button', { name: 'Loading...' });
    expect(
      within(dialog)
        .getByLabelText(form === 'raise' ? 'Additional shares' : 'Shares to issue')
        .matches(':disabled'),
    ).toBe(true);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByRole('dialog')).toBe(dialog);
    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);
    });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Loading...' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => rejectRequest(new Error('Refused')));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(
      (within(dialog).getByLabelText(form === 'raise' ? 'Additional shares' : 'Shares to issue') as HTMLInputElement)
        .value,
    ).toBe('2');
    fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
);

it.each(['issue', 'raise'] as const)('blocks the prepared %s request while class state is refreshing', async (form) => {
  show();
  let dialog: HTMLElement;
  if (form === 'raise') {
    dialog = await openRaise();
    fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '2' } });
  } else {
    fireEvent.click(await screen.findByRole('button', { name: 'Request issuance' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Recipient address'), { target: { value: '0x' + '3'.repeat(40) } });
    fireEvent.change(within(dialog).getByLabelText('Shares to issue'), { target: { value: '2' } });
  }
  let resolveRead: (value: unknown) => void = () => {};
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string) =>
    url === CLASS
      ? new Promise((resolve) => {
          resolveRead = resolve;
        })
      : original(url),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ['token', 'class-one', 'profile-one', 'account-one'], exact: true });
  });
  expect(await within(dialog).findByText('Refreshing class state before continuing.')).toBeTruthy();
  const confirm = form === 'raise' ? 'Create request' : 'Submit issuance request';
  expect((within(dialog).getByRole('button', { name: confirm }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => resolveRead({ data: { ...token } }));
  await waitFor(() =>
    expect((within(dialog).getByRole('button', { name: confirm }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(
    (within(dialog).getByLabelText(form === 'raise' ? 'Additional shares' : 'Shares to issue') as HTMLInputElement)
      .value,
  ).toBe('2');
});

it('downloads only the successful register CSV and reports failed attempts', async () => {
  const create = vi.fn(() => 'blob:synthetic');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  show();
  const button = await screen.findByRole('button', { name: 'Download CSV' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  failed = EXPORT;
  fireEvent.click(button);
  expect(await screen.findByText('The register could not be downloaded. Try again.')).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
  failed = null;
  fireEvent.click(button);
  await waitFor(() => expect(clicked).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  expect(api.get).toHaveBeenCalledWith(EXPORT, { responseType: 'blob', ledovaSubmissionGuard: expect.any(Function) });
});

it('requests and saves no register CSV once the session has ended', async () => {
  const create = vi.fn(() => 'blob:synthetic');
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  show();
  const button = await screen.findByRole('button', { name: 'Download CSV' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  act(() => client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } }));
  fireEvent.click(button);
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  expect(api.get).not.toHaveBeenCalledWith(EXPORT, {
    responseType: 'blob',
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(create).not.toHaveBeenCalled();
  expect(clicked).not.toHaveBeenCalled();
});

it('reads every issuance and authorised-share request page and submits a retained draft for review', async () => {
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number; token?: string } }) => {
    const page = config?.params?.page ?? 1;
    if (url === ISSUANCES)
      return {
        data: {
          ...EMPTY,
          next: page === 1 ? 'https://example.test/issuances/?page=2' : null,
          results: [
            {
              uuid: `issuance-${page}`,
              amount: page === 2 ? '9007199254740993' : '1',
              recipientAddress: `wallet-${page}`,
              statusDisplay: 'Completed',
              createdAt: '2026-09-01T00:00:00Z',
              subscriptionReference: page === 2 ? 'APP-2' : null,
            },
          ],
        },
      };
    if (url === CAPITAL)
      return {
        data: {
          ...EMPTY,
          next: page === 1 ? 'https://example.test/requests/?page=2' : null,
          results: [
            {
              uuid: `capital-${page}`,
              additionalShares: page,
              newAuthorizedTotal: 1000 + page,
              purpose: `Capital purpose ${page}`,
              status: page === 2 ? 'draft' : 'executed',
              statusDisplay: page === 2 ? 'Draft' : 'Executed',
              createdAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      };
    return original(url);
  });
  show();
  expect(await screen.findByText('9,007,199,254,740,993 shares to wallet-2')).toBeTruthy();
  expect(screen.getByText('Application APP-2')).toBeTruthy();
  expect(await screen.findByText('Capital purpose 2')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(CAPITAL, {
    params: { token: 'class-one', page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(ISSUANCES, { params: { page: 2 }, ledovaSubmissionGuard: expect.any(Function) });
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      COMPANY_TOKEN_ENDPOINTS.CAPITAL_INCREASE_SUBMIT('capital-2'),
      undefined,
      expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
    ),
  );
});

it('suppresses previously displayed history when a later page refresh fails', async () => {
  const original = api.get.getMockImplementation()!;
  let broken = false;
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url !== CAPITAL) return original(url);
    const page = config?.params?.page ?? 1;
    if (page === 2 && broken) throw new Error('Unavailable');
    return {
      data: {
        ...EMPTY,
        next: page === 1 ? 'https://example.test/requests/?page=2' : null,
        results: [
          {
            uuid: `capital-${page}`,
            additionalShares: 1,
            newAuthorizedTotal: 1001,
            purpose: `Cached purpose ${page}`,
            status: 'draft',
            statusDisplay: 'Draft',
            createdAt: '2026-09-01T00:00:00Z',
          },
        ],
      },
    };
  });
  show();
  await screen.findByText('Cached purpose 2');
  broken = true;
  await act(async () =>
    client.invalidateQueries({ queryKey: ['token', 'class-one', 'profile-one', 'account-one', 'capital-increases'] }),
  );
  await screen.findByText("We couldn't load authorised share requests.");
  expect(screen.queryByText('Cached purpose 1')).toBeNull();
  expect(screen.queryByText('Cached purpose 2')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
});

const APPOINTMENT: OwnCompanyAppointment = {
  uuid: 'appointment-one',
  company: 'company-one',
  companyName: 'Harbour Example Pty Ltd',
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
const DIGEST = 'd'.repeat(64);
function proposal(body: RegisterDeploymentPreparation): RegisterDeployment {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: 'company-one',
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
      company: { uuid: 'company-one', name: 'Harbour Example Pty Ltd', acn: '123456789', status: 'active' },
      token: {
        uuid: body.token,
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
async function appointee() {
  prepareCompanyClient(client, 'investor');
  token = { ...token, status: 'draft', statusDisplay: 'Draft', isOwner: false };
  appointments = [APPOINTMENT];
  show();
  await screen.findByRole('button', { name: COPY.PREPARE });
}

it('lets an ordinary company appointee prepare while exposing no owner-only histories or actions', async () => {
  await appointee();
  expect(screen.queryByText('Issuance requests')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request issuance' })).toBeNull();
  for (const path of [ISSUANCES, REQUESTS, CAPITAL, '/api/v1/companies/company-one/'])
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain(path);
  appointments = [];
  await act(async () => client.invalidateQueries({ queryKey: ['company-appointments'] }));
  await waitFor(() => expect(screen.queryByRole('button', { name: COPY.PREPARE })).toBeNull());
  expect(api.post).not.toHaveBeenCalled();
});

it.each(['deploying', 'failed read'])(
  'recovers the original preparation after an ambiguous response and %s',
  async (state) => {
    let attempts = 0;
    api.post.mockImplementation(async (_url, body: RegisterDeploymentPreparation) => {
      if (++attempts === 1) throw new Error('Response lost');
      const result = proposal(body);
      deployments = [result];
      return { data: result };
    });
    await appointee();
    fireEvent.click(screen.getByRole('button', { name: COPY.PREPARE }));
    await screen.findByRole('button', { name: 'Recover preparation receipt' });
    const original = api.post.mock.calls[0][1];
    token.status = 'deploying';
    appointments = [];
    if (state === 'failed read') failed = CLASS;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['token', 'class-one'] });
      await client.invalidateQueries({ queryKey: ['company-appointments'] });
    });
    expect(screen.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Recover preparation receipt' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][1]).toEqual(original);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Recover preparation receipt' })).toBeNull());
    expect(screen.getByText(original.operationId)).toBeTruthy();
  },
);

it('recovers the exact apply body after its stage and appointment disappear, showing admission separately', async () => {
  const original = proposal({ operationId: 'proposal-one', appointment: APPOINTMENT.uuid, token: 'class-one' });
  deployments = [original];
  let appliedBody: RegisterDeploymentDecideRequest | undefined;
  let attempts = 0;
  api.post.mockImplementation(async (url: string, body: RegisterDeploymentDecideRequest) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENT_PREVIEW(original.uuid))
      return {
        data: {
          snapshot: original.snapshot,
          intentDigest: DIGEST,
          previewDigest: DIGEST,
          unmetRequirements: [],
          canDecide: true,
          approvalDecision: 'approval-one',
          deploymentId: null,
        },
      };
    appliedBody ??= body;
    if (++attempts === 1) throw new Error('Response lost');
    return {
      data: {
        ...original,
        status: 'applied',
        stage: 'applied',
        deploymentId: 'deployment-one',
        approvalDecision: 'approval-one',
        reviewedAt: '2026-10-07T01:00:00Z',
        decisions: [
          {
            uuid: 'decision-one',
            kind: body.kind,
            appointment: body.appointment,
            idempotencyKey: body.idempotencyKey,
            digest: body.previewDigest,
            reason: body.reason ?? '',
            decidedBy: 1,
            decidedByName: 'Synthetic Applier',
            decidedAt: '2026-10-07T01:00:00Z',
          },
        ],
      },
    };
  });
  await appointee();
  fireEvent.click(await screen.findByRole('button', { name: /^Apply deployment/ }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText(COPY.CONFIRMATIONS.apply);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply deployment' }));
  await screen.findByRole('button', { name: /^Recover apply deployment receipt/ });
  appointments = [];
  token.status = 'deploying';
  deployments = [
    {
      ...original,
      status: 'applied',
      stage: 'applied',
      deploymentId: 'deployment-one',
      approvalDecision: 'approval-one',
    },
  ];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['token', 'class-one'] });
    await client.invalidateQueries({ queryKey: ['company-appointments'] });
  });
  fireEvent.click(screen.getByRole('button', { name: /^Recover apply deployment receipt/ }));
  await waitFor(() => expect(attempts).toBe(2));
  const writes = api.post.mock.calls.filter(
    ([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENT_DECIDE(original.uuid),
  );
  expect(writes[1][1]).toEqual(appliedBody);
  expect(await screen.findByText('Admitted; execution pending')).toBeTruthy();
  expect(screen.queryByText('Confirmed and projected')).toBeNull();
});

it.each([
  [false, null, null, null, 'Absent'],
  [true, false, 0, null, 'Present; not opened'],
  [true, true, 4, '0', 'Opened'],
] as const)(
  'retains the distinct register snapshot with present=%s and initialized=%s',
  async (present, initialized, sequence, issuedSupply, label) => {
    const retained = proposal({ operationId: 'snapshot-proposal', appointment: APPOINTMENT.uuid, token: 'class-one' });
    retained.snapshot.register = {
      present,
      initialized,
      uuid: present ? 'register-one' : null,
      sequence,
      headHash: present ? 'a'.repeat(64) : null,
      issuedSupply,
    };
    deployments = [retained];
    await appointee();
    const item = (await screen.findByText('snapshot-proposal')).closest('li')!;
    expect(within(item).getByText(label)).toBeTruthy();
    expect(within(item).getByText(retained.snapshot.issuerWallet.address + ' · base')).toBeTruthy();
    expect(within(item).getByText(retained.snapshot.transaction.to)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  },
);

it.each(['session', 'account'])(
  'drops a delayed preparation receipt after the %s changes and guards its auth retry',
  async (boundary) => {
    let respond!: (value: unknown) => void;
    api.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    await appointee();
    fireEvent.click(screen.getByRole('button', { name: COPY.PREPARE }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = api.post.mock.calls[0][1] as RegisterDeploymentPreparation;
    const config = api.post.mock.calls[0][2];
    act(() => {
      if (boundary === 'session') client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      else
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'foreign-profile', userAccount: { uuid: 'foreign-account', role: 'investor' } },
        });
    });
    expect(() => config.ledovaSubmissionGuard()).toThrow('signed-in account changed');
    await act(async () => respond({ data: proposal(body) }));
    expect(screen.queryByText(body.operationId)).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);

async function ownerDraft(kind: 'issue' | 'raise', shown = false) {
  if (!shown) show();
  fireEvent.click(
    await screen.findByRole('button', { name: kind === 'issue' ? 'Request issuance' : 'Raise authorised shares' }),
  );
  const dialog = await screen.findByRole('dialog');
  if (kind === 'issue') {
    fireEvent.change(within(dialog).getByLabelText('Recipient address'), { target: { value: '0x' + '3'.repeat(40) } });
    fireEvent.change(within(dialog).getByLabelText('Shares to issue'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Private owner draft' } });
  } else {
    fireEvent.change(within(dialog).getByLabelText('Additional shares'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Purpose'), { target: { value: 'Private owner draft' } });
    fireEvent.change(within(dialog).getByLabelText('Board resolution reference'), { target: { value: 'OWNER-1' } });
  }
  return dialog;
}

it.each([
  ['issue', 'owner'],
  ['raise', 'owner'],
  ['issue', 'account'],
  ['raise', 'account'],
  ['issue', 'session'],
  ['raise', 'session'],
] as const)(
  'isolates the pending %s owner draft after its %s boundary changes and refuses its transport retry/callback',
  async (kind, boundary) => {
    let reply!: (value: unknown) => void;
    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const dialog = await ownerDraft(kind);
    fireEvent.click(
      within(dialog).getByRole('button', { name: kind === 'issue' ? 'Submit issuance request' : 'Create request' }),
    );
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const config = api.post.mock.calls[0][2];
    if (boundary === 'owner') {
      token.isOwner = false;
      await act(async () => client.invalidateQueries({ queryKey: ['token', 'class-one'] }));
    } else if (boundary === 'session') {
      act(() => {
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
      });
    } else {
      act(() =>
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'profile-one', userAccount: { uuid: 'account-two', role: 'company' } },
        }),
      );
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByDisplayValue('Private owner draft')).toBeNull();
    expect(() => config.ledovaSubmissionGuard()).toThrow();
    token.isOwner = true;
    await act(async () => client.invalidateQueries({ queryKey: ['token', 'class-one'] }));
    fireEvent.click(
      await screen.findByRole('button', { name: kind === 'issue' ? 'Request issuance' : 'Raise authorised shares' }),
    );
    const fresh = await screen.findByRole('dialog');
    const label = kind === 'issue' ? 'Reason (optional)' : 'Purpose';
    expect((within(fresh).getByLabelText(label) as HTMLInputElement).value).toBe('');
    fireEvent.change(within(fresh).getByLabelText(label), { target: { value: 'New current draft' } });
    await act(async () => reply({ data: {} }));
    expect((within(screen.getByRole('dialog')).getByLabelText(label) as HTMLInputElement).value).toBe(
      'New current draft',
    );
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);

it.each(['issue', 'raise'] as const)(
  'blocks %s transport/auth retry during a same-owner class refresh and accepts the original healthy response',
  async (kind) => {
    let reply!: (value: unknown) => void;
    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const dialog = await ownerDraft(kind);
    fireEvent.click(
      within(dialog).getByRole('button', { name: kind === 'issue' ? 'Submit issuance request' : 'Create request' }),
    );
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const config = api.post.mock.calls[0][2];
    const originalRead = api.get.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    api.get.mockImplementation((url: string) =>
      url === CLASS
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : originalRead(url),
    );
    let refreshed!: Promise<unknown>;
    act(() => {
      refreshed = client.invalidateQueries({
        queryKey: ['token', 'class-one', 'profile-one', 'account-one'],
        exact: true,
      });
    });
    await within(dialog).findByText('Refreshing class state before continuing.');
    expect(() => config.ledovaSubmissionGuard()).toThrow('Refresh the owner share class');
    expect(
      (within(dialog).getByLabelText(kind === 'issue' ? 'Reason (optional)' : 'Purpose') as HTMLInputElement).value,
    ).toBe('Private owner draft');
    api.get.mockImplementation(originalRead);
    await act(async () => {
      finish({ data: { ...token } });
      await refreshed;
    });
    expect(() => config.ledovaSubmissionGuard()).not.toThrow();
    await act(async () => reply({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);
