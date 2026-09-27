// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COMPANY_TOKEN_ENDPOINTS, type CompanyShareToken, type TokenHoldersResponse } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import { ShareClass } from '.';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('../components/TokenPauseControls', () => ({ TokenPauseControls: () => <p>Existing pause controls</p> }));
let client: QueryClient;
let token: CompanyShareToken;
let register: TokenHoldersResponse;
let companyStatus: string;
let failed: string | null;
const EMPTY = { results: [], count: 0, next: null, previous: null };
const CLASS = COMPANY_TOKEN_ENDPOINTS.DETAIL('class-one');
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('class-one');
const ISSUANCES = COMPANY_TOKEN_ENDPOINTS.ISSUANCES('class-one');
const REQUESTS = COMPANY_TOKEN_ENDPOINTS.ISSUANCE_REQUESTS;
const CAPITAL = COMPANY_TOKEN_ENDPOINTS.CAPITAL_INCREASES;
const EXPORT = COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT('class-one');

function show() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PageTitle.Provider value="Share class">
          <ShareClass uuid="class-one" />
        </PageTitle.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  companyStatus = 'active';
  token = {
    uuid: 'class-one',
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
    if (url === '/api/v1/companies/company-one/') return { data: { uuid: 'company-one', status: companyStatus } };
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
  expect(screen.getByRole('link', { name: 'Back to Register' }).getAttribute('href')).toBe('/company/register');
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
    expect(!!screen.queryByRole('button', { name: 'Deploy class' })).toBe(status === 'draft');
  },
);

it('requires the actual parent company to be active before deploying', async () => {
  token.status = 'draft';
  companyStatus = 'approved';
  show();
  const button = await screen.findByRole('button', { name: 'Deploy class' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
  companyStatus = 'active';
  await act(async () => client.invalidateQueries({ queryKey: ['company', 'company-one'] }));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.DEPLOY('class-one')));
});

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
  expect(api.get.mock.calls.map(([url]) => url)).toEqual([CLASS]);
  expect(screen.queryByRole('button', { name: 'Request issuance' })).toBeNull();
});

it('hides a stale class and its actions after its read starts failing', async () => {
  show();
  await screen.findByText('Ordinary shares');
  failed = CLASS;
  await act(async () => client.invalidateQueries({ queryKey: ['token', 'class-one'], exact: true }));
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
    await act(async () => client.invalidateQueries({ queryKey: ['token', 'class-one'], exact: true }));
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
        expect(api.post).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.ISSUE('class-one'), {
          recipient: '0x' + '3'.repeat(40),
          amount: Number(amount),
          reason: undefined,
        }),
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
        expect(api.post).toHaveBeenCalledWith(CAPITAL, {
          token: 'class-one',
          additionalShares: 1,
          newAuthorizedTotal: 2147483647,
          purpose: 'Fictional expansion',
          boardResolutionReference: 'EXAMPLE-2026-1',
          shareholderApprovalReference: undefined,
        }),
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
  await act(async () => client.invalidateQueries({ queryKey: ['token', 'class-one'], exact: true }));
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
    void client.invalidateQueries({ queryKey: ['token', 'class-one'], exact: true });
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
  expect(api.get).toHaveBeenCalledWith(EXPORT, { responseType: 'blob' });
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
  expect(api.get).toHaveBeenCalledWith(CAPITAL, { params: { token: 'class-one', page: 2 } });
  expect(api.get).toHaveBeenCalledWith(ISSUANCES, { params: { page: 2 } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.CAPITAL_INCREASE_SUBMIT('capital-2')),
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
  await act(async () => client.invalidateQueries({ queryKey: ['token', 'class-one', 'capital-increases'] }));
  await screen.findByText("We couldn't load authorised share requests.");
  expect(screen.queryByText('Cached purpose 1')).toBeNull();
  expect(screen.queryByText('Cached purpose 2')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
});
