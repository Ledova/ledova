import React from 'react';
import { RefreshControl } from 'react-native';
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useSubscription } from './useApplications';
import { ApplicationsScreen } from './ApplicationsScreen';
import { ApplicationDetailScreen } from './ApplicationDetailScreen';
import { ShareClassScreen } from '../directory/ShareClassScreen';
import { ApplicationsStackNavigator } from '../../navigation/ApplicationsStackNavigator';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
let mockRole = { isInvestor: true, isLoading: false };
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: () => ({ navigate: mockParentNavigate }),
    isFocused: () => mockFocused,
  }),
  useRoute: () => ({ params: { uuid: 'item-a' } }),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: ({ name, component: Component }: { name: string; component: React.ComponentType }) =>
      name === 'ApplicationsMain' ? <Component /> : null,
  }),
}));
jest.mock('../../navigation/headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('../../hooks/useRole', () => ({ useRole: () => mockRole }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const listUrl = '/api/v1/subscriptions/';
const detailUrl = `${listUrl}item-a/`;
const classUrl = '/api/v1/directory/tokens/item-a/';
const walletsUrl = '/api/wallets/';
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
let client: QueryClient;
let application: ReturnType<typeof record>;
let pages: Record<number, object>;
let walletPages: Record<number, object>;
let failure: string | null;
let missing: boolean;
let offering: { uuid: string; pricePerShare: string; priceCurrency: 'AUD'; opensAt: string; closesAt: null } | null;

function bankInstruction() {
  return {
    rail: 'bank_transfer',
    reference: '00-EXACT-REF',
    amountDue: '36.90',
    currency: 'AUD',
    payee: 'Fictional Operator',
    bankAccountName: 'Fictional Client Account',
    bankBsb: '001234',
    bankAccountNumber: '0000123456',
    issuedAt: '2026-09-02T01:00:00Z',
    paymentDueAt: '2026-10-01T01:00:00Z',
  };
}
function record(uuid = 'item-a', status = 'draft') {
  return {
    uuid,
    status,
    statusDisplay: status,
    companyName: 'Recorded Fictional Issuer',
    tokenName: 'Recorded Ordinary Shares',
    tokenSymbol: 'OLD',
    quantity: 3,
    allottedQuantity: null as number | null,
    amountDue: '36.90',
    amountReceived: null as string | null,
    amountOutstanding: '36.90',
    pricePerShare: '12.30',
    currency: 'AUD',
    walletAddress: '0x00000000000000000000000000000000000000ab',
    reference: '00-EXACT-REF',
    createdAt: '2026-09-01T01:00:00Z',
    submittedAt: null as string | null,
    acceptedAt: null,
    paymentInstructionIssuedAt: null,
    paymentReceivedOn: null,
    allottedAt: null,
    refundedAt: null,
    closedAt: null,
    refundAmount: null as string | null,
    paymentInstruction: null as object | null,
  };
}
function wallet(uuid: string) {
  return {
    uuid,
    name: `Wallet ${uuid}`,
    address: `0x${uuid.padStart(40, '0')}`,
    chain: 'base',
    verificationStatus: 'VERIFIED',
  };
}

beforeEach(() => {
  mockRole = { isInvestor: true, isLoading: false };
  mockFocused = true;
  application = record();
  pages = { 1: { results: [application], next: null } };
  walletPages = {
    1: { results: [wallet('a')], next: `https://example.test${walletsUrl}?page=2` },
    2: { results: [wallet('b')], next: null },
  };
  offering = { uuid: 'offer-a', pricePerShare: '12.30', priceCurrency: 'AUD', opensAt: '2026-09-01', closesAt: null };
  failure = null;
  missing = false;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  jest.mocked(Clipboard.setStringAsync).mockReset().mockResolvedValue(true);
  post.mockReset();
  get.mockReset().mockImplementation(async (url, config) => {
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (failure === url || failure === `${url}${page}`) throw new Error('Synthetic read unavailable');
    if (url === listUrl) return { data: pages[page] };
    if (url === detailUrl) {
      if (missing) throw { response: { status: 404 } };
      return { data: { ...application } };
    }
    if (url === classUrl)
      return {
        data: {
          uuid: 'item-a',
          companyUuid: 'issuer-a',
          company: { displayName: 'Current Fictional Issuer' },
          name: 'Current Ordinary Shares',
          symbol: 'CUR',
          totalSupply: '1000',
          issuedShares: 0,
          openOffering: offering,
        },
      };
    if (url === walletsUrl) return { data: walletPages[page] };
    if (url === '/api/operator/') return { data: { name: 'Fictional Operator' } };
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
async function refresh(key: string[]) {
  await act(async () => {
    await client.invalidateQueries({ queryKey: key });
  });
}
async function draft() {
  const view = await render(<ShareClassScreen />, { wrapper });
  await fireEvent.changeText(await view.findByLabelText('Shares'), '3');
  await fireEvent.press(view.getByRole('radio', { name: 'Receiving wallet Wallet b' }));
  return view;
}

it.each([
  [true, true],
  [false, false],
])('guards application routes until an investing role is available (%s, %s)', async (isLoading, isInvestor) => {
  mockRole = { isLoading, isInvestor };
  const view = await render(<ApplicationsStackNavigator onNotifications={() => {}} unreadCount={0} />, { wrapper });
  expect(get).not.toHaveBeenCalled();
  mockRole = { isLoading: false, isInvestor: true };
  await view.rerender(<ApplicationsStackNavigator onNotifications={() => {}} unreadCount={0} />);
  expect(await view.findByText('Recorded Fictional Issuer · Recorded Ordinary Shares')).toBeTruthy();
});

it('reads historical snapshots without directory authority and reports later-page failure as incomplete', async () => {
  pages = {
    1: { results: [application], next: `https://example.test${listUrl}?page=2` },
    2: { results: [record('item-b', 'allotted')], next: null },
  };
  const view = await render(<ApplicationsScreen />, { wrapper });
  expect(await view.findByText('Draft')).toBeTruthy();
  failure = `${listUrl}2`;
  await fireEvent.press(view.getByText('Load more applications'));
  expect(await view.findByText('More applications could not be loaded. The list is incomplete.')).toBeTruthy();
  expect(view.getByText('Draft')).toBeTruthy();
  failure = null;
  await fireEvent.press(view.getByText('Try more applications again'));
  expect(await view.findByText('Shares allotted')).toBeTruthy();
  expect(get.mock.calls.every(([url]) => url === listUrl)).toBe(true);
});

it('suppresses cached application history on a failed refresh and recovers to a reliable empty list', async () => {
  const view = await render(<ApplicationsScreen />, { wrapper });
  expect(await view.findByText('Draft')).toBeTruthy();
  failure = listUrl;
  await refresh(['subscriptions']);
  expect(await view.findByText(/Your applications could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Draft')).toBeNull();
  expect(view.queryByText('No applications yet')).toBeNull();
  pages = { 1: { results: [], next: null } };
  failure = null;
  await fireEvent.press(view.getByText('Try again'));
  await fireEvent.press(await view.findByText('Open Directory'));
  expect(mockParentNavigate).toHaveBeenCalledWith('Directory', { screen: 'DirectoryMain' });
});

it('rejects non-advancing application pagination instead of publishing an incomplete first page', async () => {
  pages = { 1: { results: [application], next: `https://example.test${listUrl}?page=1` } };
  const view = await render(<ApplicationsScreen />, { wrapper });
  expect(await view.findByText(/Your applications could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Draft')).toBeNull();
});

it('opens the selected recorded application and never converts unsafe numeric share counts', async () => {
  application.quantity = Number.MAX_SAFE_INTEGER + 1;
  const view = await render(<ApplicationsScreen />, { wrapper });
  expect(await view.findByText('Unavailable')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Open application 00-EXACT-REF'));
  expect(mockNavigate).toHaveBeenCalledWith('ApplicationDetail', { uuid: 'item-a' });
});

it('awaits submit and refreshed status, prevents duplicate actions, and keeps refusal available for retry', async () => {
  post.mockRejectedValueOnce(new Error('Fictional submission refused'));
  const view = await render(<ApplicationDetailScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Submit for review'));
  expect(await view.findByText('Fictional submission refused')).toBeTruthy();
  let finish!: (value: object) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(view.getByText('Submit for review'));
  expect(await view.findByText('Submitting…')).toBeDisabled();
  expect(view.getByText('Withdraw')).toBeDisabled();
  await fireEvent.press(view.getByText('Submitting…'));
  expect(post).toHaveBeenCalledTimes(2);
  application.status = 'submitted';
  application.submittedAt = '2026-09-02T01:00:00Z';
  await act(async () => {
    finish({ data: application });
  });
  expect(await view.findByText('Under review by the operator')).toBeTruthy();
  expect(view.queryByText('Submit for review')).toBeNull();
  expect(post).toHaveBeenLastCalledWith(`${detailUrl}submit/`, {}, { ledovaSessionEpoch: getSessionEpoch() });
});

it('awaits withdrawal and refresh, preserving the refusal until a successful retry', async () => {
  post.mockRejectedValueOnce(new Error('Fictional withdrawal refused')).mockImplementationOnce(async () => {
    application.status = 'withdrawn';
    return { data: application };
  });
  const view = await render(<ApplicationDetailScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Withdraw'));
  expect(await view.findByText('Fictional withdrawal refused')).toBeTruthy();
  await fireEvent.press(view.getByText('Withdraw'));
  expect(await view.findByText('Withdrawn')).toBeTruthy();
  expect(view.queryByText('Withdraw')).toBeNull();
  expect(post).toHaveBeenLastCalledWith(
    `${detailUrl}withdraw/`,
    { reason: 'Withdrawn by the investor' },
    { ledovaSessionEpoch: getSessionEpoch() },
  );
});

it('does not allow stale detail actions while refreshing or after a failed refresh and handles cached404', async () => {
  const view = await render(<ApplicationDetailScreen />, { wrapper });
  expect(await view.findByText('Submit for review')).toBeEnabled();
  let finish!: (value: object) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  await waitFor(() => expect(view.getByText('Submit for review')).toBeDisabled());
  await fireEvent.press(view.getByText('Submit for review'));
  expect(post).not.toHaveBeenCalled();
  await act(async () => {
    finish({ data: application });
    await pending;
  });
  failure = detailUrl;
  await refresh(['subscriptions']);
  expect(await view.findByText(/This application could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Submit for review')).toBeNull();
  failure = null;
  missing = true;
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('Not available')).toBeTruthy();
  expect(view.queryByText('Draft')).toBeNull();
});

it('uses original bank instructions and exact leading zeros after partial payment without allowing withdrawal', async () => {
  application.status = 'awaiting_payment';
  application.amountReceived = '10.00';
  application.amountOutstanding = '26.90';
  application.paymentInstruction = bankInstruction();
  const view = await render(<ApplicationDetailScreen />, { wrapper });
  expect(await view.findByText(/These are the original instruction amounts/)).toBeTruthy();
  expect(view.queryByText('Withdraw')).toBeNull();
  expect(view.getByText('001234')).toBeTruthy();
  expect(view.getByText('0000123456')).toBeTruthy();
  for (const [label, value] of [
    ['Copy reference', '00-EXACT-REF'],
    ['Copy account number', '0000123456'],
    ['Copy amount on instruction', '36.90'],
  ]) {
    await fireEvent.press(view.getByText(label));
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(value);
  }
  expect(view.getByText('AUD\u00a026.90')).toBeTruthy();
});

it('keeps clipboard refusal explicit and retries the exact value', async () => {
  application.status = 'awaiting_payment';
  application.paymentInstruction = bankInstruction();
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Denied')).mockResolvedValueOnce(true);
  const view = await render(<ApplicationDetailScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Copy reference'));
  expect(await view.findByText('Could not copy reference. Please try again.')).toBeTruthy();
  await fireEvent.press(view.getByText('Copy reference'));
  expect(await view.findByText('Copied reference')).toBeTruthy();
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('00-EXACT-REF');
});

it('renders issued token-settlement instruction fields exactly without generic payment fallbacks', async () => {
  application.status = 'awaiting_payment';
  application.paymentInstruction = {
    rail: 'token_transfer',
    reference: 'REF-TOKEN',
    amountDue: '36.90',
    currency: 'AUD',
    payee: 'Fictional Operator',
    chain: 'base',
    assetSymbol: 'AUDX',
    contractAddress: '0x00000000000000000000000000000000000000aa',
    receivingWalletAddress: '0x00000000000000000000000000000000000000bb',
    settlementAmount: '36900000000000000000',
    decimals: 18,
  };
  const view = await render(<ApplicationDetailScreen />, { wrapper });
  expect(await view.findByText('36900000000000000000')).toBeTruthy();
  await fireEvent.press(view.getByText('Copy raw units'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('36900000000000000000');
  expect(view.getByText('AUDX')).toBeTruthy();
  expect(view.queryByText('BSB')).toBeNull();
  application.paymentInstruction = null;
  await refresh(['subscriptions']);
  expect(await view.findByText('Payment instruction unavailable')).toBeTruthy();
  expect(view.queryByText('Copy raw units')).toBeNull();
  expect(get.mock.calls.every(([url]) => url === detailUrl)).toBe(true);
});

it('creates a draft using the second-page verified wallet and exact whole-share quantity', async () => {
  const view = await draft();
  expect(view.getByText('AUD\u00a036.90')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(walletsUrl, { params: { chain: 'base', verification_status: 'VERIFIED', page: 2 } });
  post.mockResolvedValueOnce({ data: { uuid: 'created-application' } });
  await fireEvent.press(view.getByText('Create application'));
  await waitFor(() =>
    expect(mockParentNavigate).toHaveBeenCalledWith('Applications', {
      screen: 'ApplicationDetail',
      params: { uuid: 'created-application' },
    }),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(
    listUrl,
    { offering: 'offer-a', wallet: 'b', quantity: 3 },
    { ledovaSessionEpoch: getSessionEpoch() },
  );
});

it.each(['0', '-1', '1.5', '1e3', '9007199254740992'])('refuses invalid or inexact quantity %s', async (quantity) => {
  const view = await draft();
  await fireEvent.changeText(view.getByLabelText('Shares'), quantity);
  expect(view.getByText('Create application')).toBeDisabled();
  await fireEvent.press(view.getByText('Create application'));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getByLabelText('Shares'), '7');
  expect(view.getByText('Create application')).toBeEnabled();
});

it.each([classUrl, walletsUrl])(
  'retains quantity and selected wallet through failed %s refresh and a write refusal',
  async (url) => {
    const view = await draft();
    failure = url;
    await refresh(url === classUrl ? ['directory'] : ['wallets']);
    await waitFor(() => expect(view.queryByText('Create application')).toBeNull());
    failure = null;
    await fireEvent.press(view.getByText(url === classUrl ? 'Try again' : 'Try wallets again'));
    expect(await view.findByDisplayValue('3')).toBeTruthy();
    expect(view.getByRole('radio', { name: 'Receiving wallet Wallet b' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true }),
    );
    post
      .mockRejectedValueOnce(new Error('Fictional draft refused'))
      .mockResolvedValueOnce({ data: { uuid: 'created' } });
    await fireEvent.press(view.getByText('Create application'));
    expect(await view.findByText('Fictional draft refused')).toBeTruthy();
    expect(view.getByDisplayValue('3')).toBeTruthy();
    await fireEvent.press(view.getByText('Create application'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ offering: 'offer-a', wallet: 'b', quantity: 3 });
  },
);

it('blocks duplicate draft writes and prevents old-session success from navigating or refreshing the next account', async () => {
  const view = await draft();
  let finish!: (value: object) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(view.getByText('Create application'));
  expect(await view.findByText('Creating draft…')).toBeDisabled();
  expect(view.getByLabelText('Shares')).toHaveProp('editable', false);
  await fireEvent.press(view.getByText('Creating draft…'));
  expect(post).toHaveBeenCalledTimes(1);
  invalidateSessionScope();
  await act(async () => {
    finish({ data: { uuid: 'old-session-created' } });
  });
  expect(await view.findByText('The saved session changed.')).toBeTruthy();
  expect(mockParentNavigate).not.toHaveBeenCalled();
});

it('does not navigate after leaving a pending draft creation', async () => {
  const view = await draft();
  let finish!: (value: object) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(view.getByText('Create application'));
  await view.unmount();
  await act(async () => {
    finish({ data: { uuid: 'created-after-leaving' } });
  });
  expect(mockParentNavigate).not.toHaveBeenCalled();
});

it('requires another selection when a receiving wallet disappears and clears a draft for a replacement offering', async () => {
  const view = await draft();
  walletPages = { 1: { results: [wallet('a')], next: null } };
  await refresh(['wallets']);
  expect(view.getByDisplayValue('3')).toBeTruthy();
  await waitFor(() => expect(view.getByText('Create application')).toBeDisabled());
  await fireEvent.press(view.getByRole('radio', { name: 'Receiving wallet Wallet a' }));
  expect(view.getByText('Create application')).toBeEnabled();
  offering = { ...offering!, uuid: 'replacement' };
  await refresh(['directory']);
  await waitFor(() => expect(view.getByLabelText('Shares')).toHaveProp('value', ''));
  expect(view.getByText('Create application')).toBeDisabled();
});

it('offers Wallets only after a complete reliable empty wallet read', async () => {
  walletPages = { 1: { results: [], next: null } };
  const view = await render(<ShareClassScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Open Wallets'));
  expect(mockParentNavigate).toHaveBeenCalledWith('Wallets', { screen: 'WalletsList' });
  expect(view.queryByText('Create application')).toBeNull();
});

it('rejects incomplete receiving-wallet pagination without enabling a partial choice', async () => {
  walletPages = { 1: { results: [wallet('a')], next: `https://example.test${walletsUrl}?cursor=next` } };
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText(/Your receiving wallets could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Create application')).toBeNull();
  expect(view.queryByText('Open Wallets')).toBeNull();
});

it.each([classUrl, walletsUrl])('blocks draft creation during an in-flight prerequisite refresh of %s', async (url) => {
  const view = await draft();
  const response = url === classUrl ? client.getQueryData(['directory', 'token', 'item-a']) : { data: walletPages[1] };
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = client.invalidateQueries({ queryKey: url === classUrl ? ['directory'] : ['wallets'] });
  });
  await waitFor(() => expect(view.getByText('Create application')).toBeDisabled());
  await fireEvent.press(view.getByText('Create application'));
  expect(post).not.toHaveBeenCalled();
  await act(async () => {
    finish(response);
    await pending;
  });
  await waitFor(() => expect(view.getByText('Create application')).toBeEnabled());
  expect(view.getByDisplayValue('3')).toBeTruthy();
});

it.each(['submit', 'withdraw'] as const)(
  'keeps the selected application for %s while React Query replaces held mutation options',
  async (action) => {
    let enter!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    client.setDefaultOptions({
      ...client.getDefaultOptions(),
      mutations: {
        retry: false,
        gcTime: 0,
        onMutate: async () => {
          enter();
          await resumed;
        },
      },
    });
    get.mockImplementation(async () => ({ data: application }));
    post.mockResolvedValue({ data: application });
    const view = await renderHook(({ uuid }: { uuid: string }) => useSubscription(uuid), {
      wrapper,
      initialProps: { uuid: 'item-a' },
    });
    let pending!: Promise<unknown>;
    const epoch = getSessionEpoch();
    await act(async () => {
      pending =
        action === 'submit'
          ? view.result.current!.submit.mutateAsync(epoch)
          : view.result.current!.withdraw.mutateAsync({ reason: 'Fictional withdrawal', epoch });
      await started;
    });
    await view.rerender({ uuid: 'item-b' });
    expect(post).not.toHaveBeenCalled();
    await act(async () => {
      resume();
      await pending;
    });
    expect(post).toHaveBeenCalledWith(
      `${listUrl}item-a/${action}/`,
      action === 'submit' ? {} : { reason: 'Fictional withdrawal' },
      { ledovaSessionEpoch: epoch },
    );
  },
);

it('refreshes the complete receiving-wallet choices with the share-class page and retains the draft through refusal', async () => {
  const view = await draft();
  failure = walletsUrl;
  await act(async () => {
    (RefreshControl as unknown as { latestRef: { props: { onRefresh: () => void } } }).latestRef.props.onRefresh();
  });
  expect(await view.findByText('Your receiving wallets could not be loaded. Try again before applying.')).toBeTruthy();
  expect(view.queryByText('Create application')).toBeNull();
  failure = null;
  await fireEvent.press(view.getByText('Try wallets again'));
  expect(await view.findByDisplayValue('3')).toBeTruthy();
  expect(view.getByRole('radio', { name: 'Receiving wallet Wallet b' })).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ checked: true }),
  );
});
