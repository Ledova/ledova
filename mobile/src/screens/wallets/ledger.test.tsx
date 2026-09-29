import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import type { Wallet, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { WalletsScreen } from './index';
import { WalletActionScreen } from './components/WalletActionScreen';
import { useWalletsCrud } from './useWalletsCrud';
import { useWallets } from './useWallets';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';

const mockDerive = jest.fn();
jest.mock('../../utils/keystone/bcurDecoder', () => ({
  deriveAddressFromParentKey: (...args: unknown[]) => mockDerive(...args),
  extractFromKeystoneQR: () => null,
}));
const mockNavigate = jest.fn();
const mockBack = jest.fn();
let mockRouteWallet: Wallet;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockBack, canGoBack: () => true, isFocused: () => true }),
  useRoute: () => ({ params: { wallet: mockRouteWallet } }),
}));
jest.mock('../../services/apiClient', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
let mockPreferences: {
  userAccount: { uuid: string } | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
};
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => mockPreferences,
  useCurrency: () => ({ formatDisplayCurrency: () => 'AUD 42.00' }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../../components/qr', () => {
  const { Text, Pressable } = jest.requireActual('react-native');
  return {
    AnimatedQRScanner: ({ onComplete }: { onComplete: (value: string) => void }) => (
      <Pressable onPress={() => onComplete('0x' + 'a'.repeat(40))}>
        <Text>Scan fictional address</Text>
      </Pressable>
    ),
  };
});

const url = '/api/wallets/';
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const patch = jest.mocked(apiClient.patch);
const remove = jest.mocked(apiClient.delete);
let client: QueryClient;
let pages: Record<number, { results: Wallet[]; next: string | null }>;
let failedPage: number | null;

function wallet(uuid = 'a', balance = '0.000000000000000001'): Wallet {
  return {
    uuid,
    userAccount: 'owner',
    name: `Fictional ${uuid}`,
    address: '0x' + uuid.repeat(40),
    chain: 'base',
    verificationStatus: 'VERIFIED',
    verificationChallenge: null,
    verificationSignature: null,
    verifiedAt: null,
    lastSyncedAt: null,
    nativeBalance: balance,
    nativeMarketValue: '1.00',
    marketValue: '1.00',
    signingPreference: 'hardware',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const mount = (children: React.ReactElement) => render(children, { wrapper });
const refresh = () =>
  act(async () => {
    await client.invalidateQueries({ queryKey: ['wallets'] });
  });

beforeEach(() => {
  mockPreferences = { userAccount: { uuid: 'owner' }, isLoading: false, isError: false, refetch: async () => {} };
  mockRouteWallet = wallet();
  pages = {
    1: { results: [wallet()], next: `https://example.test${url}?page=2` },
    2: { results: [wallet('b', '9007199254740993.000000000000000001')], next: null },
  };
  failedPage = null;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  get.mockReset().mockImplementation(async (path, config) => {
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (path !== url) throw new Error(`Unexpected ${path}`);
    if (failedPage === page) throw new Error('Fictional read unavailable');
    return { data: pages[page] };
  });
  post.mockReset().mockResolvedValue({ data: wallet('c') });
  patch.mockReset().mockImplementation(async (_path, data) => {
    pages[1].results[0] = { ...pages[1].results[0], ...(data as object) };
    return { data: pages[1].results[0] };
  });
  remove.mockReset().mockImplementation(async () => {
    pages[1].results = [];
    return { data: null };
  });
  jest.mocked(Clipboard.setStringAsync).mockReset().mockResolvedValue(true);
  mockDerive.mockReset().mockReturnValue({
    address: '0x' + 'c'.repeat(40),
    networkType: 'BASE',
    derivationPath: "m/44'/60'/0'/0/1",
    addressIndex: 1,
  });
  mockNavigate.mockReset();
  mockBack.mockReset();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every wallet page and renders full addresses and exact balances, to eight places, without mock totals', async () => {
  pages[2].results[0].nativeBalance = '9007199254740993.123456789';
  const view = await mount(<WalletsScreen />);
  await waitFor(() => expect(view.getByText('Fictional b')).toBeTruthy());
  expect(view.getByText('9007199254740993.12345679 ETH')).toBeTruthy();
  expect(view.getByText('0 ETH')).toBeTruthy();
  expect(view.queryByText(/0\.000000000000000001/)).toBeNull();
  expect(view.getByText(wallet('b').address)).toBeTruthy();
  expect(get).toHaveBeenCalledWith(url, { params: { page: 2 }, ledovaSessionEpoch: getSessionEpoch() });
  await fireEvent.press(view.getByRole('button', { name: 'Open wallet Fictional b' }));
  expect(mockNavigate).toHaveBeenCalledWith('WalletAction', { wallet: pages[2].results[0] });
});

it("names each row's status and signing preference, and labels its sync age and figures, as the choosers do", async () => {
  pages[1].results[0] = {
    ...pages[1].results[0],
    verificationStatus: 'PENDING',
    lastSyncedAt: new Date().toISOString(),
  };
  const view = await mount(<WalletsScreen />);
  await waitFor(() => expect(view.getByText('Fictional b')).toBeTruthy());

  const row = within(view.getByRole('button', { name: 'Open wallet Fictional a' }).parent!);
  expect(row.getAllByRole('img').map((image) => image.props.accessibilityLabel)).toEqual([
    'Wallet address verification pending',
    'Hardware (self-declared)',
  ]);
  expect(row.getByText('just now')).toBeTruthy();
  expect(row.getByText(wallet('a').address).parent).toBe(row.getByText('Address').parent);
  expect(row.getByText('0 ETH').parent).toBe(row.getByText('Balance').parent);
  expect(row.getByText('AUD 42.00').parent).toBe(row.getByText('Estimated value').parent);
});

it('reports a failed later wallet page and retries the whole ledger before presenting any complete list', async () => {
  failedPage = 2;
  const view = await mount(<WalletsScreen />);
  await waitFor(() =>
    expect(view.getByText('Your wallets could not be loaded. Try again before continuing.')).toBeTruthy(),
  );
  expect(view.queryByText('Fictional a')).toBeNull();
  expect(view.queryByText('No Base wallets yet.')).toBeNull();
  failedPage = null;
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(view.getByText('Fictional b')).toBeTruthy());
});

it('shows truthful empty networks and retains Buy and Send only as wallet destinations', async () => {
  pages = { 1: { results: [], next: null } };
  const view = await mount(<WalletsScreen />);
  await waitFor(() => expect(view.getByText('No Base wallets yet.')).toBeTruthy());
  expect(view.getByText('No Bitcoin wallets yet.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Buy crypto' }));
  expect(mockNavigate).toHaveBeenCalledWith('Buy', { screen: 'BuySelect' });
  await fireEvent.press(view.getByRole('button', { name: 'Send' }));
  expect(mockNavigate).toHaveBeenCalledWith('Send', { screen: 'SendMain' });
});

describe('Send from Wallets', () => {
  const pending: Wallet = { ...wallet('p'), verificationStatus: 'PENDING' };
  const bitcoin: Wallet = { ...wallet('c'), chain: 'bitcoin', address: `tb1q${'c'.repeat(38)}` };
  const polygon = { ...wallet('d'), chain: 'polygon' } as unknown as Wallet;

  async function pressSend(results: Wallet[]) {
    pages = { 1: { results, next: null } };
    const view = await mount(<WalletsScreen />);
    await waitFor(() => expect(view.getByRole('button', { name: 'Sync balances' })).not.toBeDisabled());
    await fireEvent.press(view.getByRole('button', { name: 'Send' }));
    return view;
  }

  it('opens the form for the only verified wallet, beside a pending one and one on a network Wallets does not list', async () => {
    await pressSend([wallet('a'), pending, polygon]);
    expect(mockNavigate.mock.calls).toEqual([
      [
        'Send',
        {
          screen: 'SendMain',
          params: { wallet: pages[1].results[0] },
        },
      ],
    ]);
  });

  it("opens a Bitcoin wallet's own send form when it is the only verified wallet", async () => {
    await pressSend([bitcoin, pending]);
    expect(mockNavigate.mock.calls).toEqual([['TransferDetails', { wallet: pages[1].results[0] }]]);
  });

  it.each([
    ['several are verified', [wallet('a'), bitcoin]],
    ['none is verified', [pending]],
    ['the only verified wallet is on a network Wallets does not list', [polygon, pending]],
  ])('asks which wallet to send from when %s', async (_, results) => {
    await pressSend(results);
    expect(mockNavigate.mock.calls).toEqual([['Send', { screen: 'SendMain' }]]);
  });

  it('asks which wallet to send from when a refresh fails after reading one', async () => {
    const view = await pressSend([wallet('a')]);
    expect(mockNavigate).toHaveBeenLastCalledWith('Send', { screen: 'SendMain', params: { wallet: wallet('a') } });
    failedPage = 1;
    await refresh();
    await waitFor(() =>
      expect(view.getByText('Your wallets could not be loaded. Try again before continuing.')).toBeTruthy(),
    );

    await fireEvent.press(view.getByRole('button', { name: 'Send' }));

    expect(mockNavigate).toHaveBeenLastCalledWith('Send', { screen: 'SendMain' });
  });

  it('asks which wallet to send from while a refresh has not finished, and opens the form once it has', async () => {
    const view = await pressSend([wallet('a')]);
    const read = deferred<unknown>();
    get.mockImplementationOnce(() => read.promise as ReturnType<typeof apiClient.get>);
    let refreshed!: Promise<void>;
    try {
      await act(async () => {
        refreshed = client.invalidateQueries({ queryKey: ['wallets'] });
      });
      await waitFor(() => expect(view.getByRole('button', { name: 'Sync balances' })).toBeDisabled());

      await fireEvent.press(view.getByRole('button', { name: 'Send' }));
      expect(mockNavigate).toHaveBeenLastCalledWith('Send', { screen: 'SendMain' });
    } finally {
      await act(async () => read.resolve({ data: pages[1] }));
    }
    await act(() => refreshed);
    await waitFor(() => expect(view.getByRole('button', { name: 'Sync balances' })).not.toBeDisabled());
    await fireEvent.press(view.getByRole('button', { name: 'Send' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Send', { screen: 'SendMain', params: { wallet: wallet('a') } });
  });
});

it('heads Wallets with its lede and then every screen action in one row, before the first network card', async () => {
  const view = await mount(<WalletsScreen />);
  await waitFor(() => expect(view.getByText('Fictional b')).toBeTruthy());
  const title = view.getByRole('header', { name: 'Wallets' });
  const lede = view.getByText('Open a wallet to verify, rename, derive another address or sync its balances.');
  const actions = ['Buy crypto', 'Send', 'Add wallet', 'Sync balances'].map((name) =>
    view.getByRole('button', { name }),
  );
  const row = actions[0].parent!;
  expect(title.parent!.children).toEqual([title, lede, row]);
  expect(row.children).toEqual(actions);
  expect(title.parent!.parent!.children[1]).toBe(view.getByRole('header', { name: 'Ethereum' }).parent);
});

it('holds back the Wallets actions while the wallets are read, under the title and its lede', async () => {
  const first = deferred<unknown>();
  get.mockImplementationOnce(() => first.promise as ReturnType<typeof apiClient.get>);
  const view = await mount(<WalletsScreen />);
  try {
    expect(view.getByLabelText('Loading wallets')).toBeTruthy();
    const title = view.getByRole('header', { name: 'Wallets' });
    expect(title.parent!.children).toEqual([
      title,
      view.getByText('Open a wallet to verify, rename, derive another address or sync its balances.'),
    ]);
    for (const name of ['Buy crypto', 'Send', 'Add wallet', 'Sync balances'])
      expect(view.queryByRole('button', { name })).toBeNull();
  } finally {
    await act(async () => first.resolve({ data: pages[1] }));
  }
  expect(await view.findByRole('button', { name: 'Add wallet' })).toBeTruthy();
});

it('keeps the real add form through a failed background read and write refusal, blocking duplicate and close while pending', async () => {
  const view = await mount(<WalletsScreen />);
  await waitFor(() => expect(view.getByText('Fictional b')).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Add wallet' }));
  await fireEvent.press(view.getByText('Hardware Wallet'));
  await fireEvent.press(view.getByText('Scan fictional address'));
  await fireEvent.changeText(view.getByLabelText('Wallet name'), 'Kept draft');
  failedPage = 2;
  await refresh();
  await waitFor(() =>
    expect(view.getByText('Wallets could not be refreshed. Your draft is kept; retry before continuing.')).toBeTruthy(),
  );
  expect(view.getByLabelText('Wallet name').props.value).toBe('Kept draft');
  expect(view.getByText('Add Wallet')).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
  failedPage = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry wallets' }));
  await waitFor(() =>
    expect(view.queryByText('Wallets could not be refreshed. Your draft is kept; retry before continuing.')).toBeNull(),
  );
  post.mockRejectedValueOnce(new Error('Fictional create refused'));
  await fireEvent.press(view.getByText('Add Wallet'));
  await waitFor(() => expect(view.getByText('Fictional create refused')).toBeTruthy());
  expect(view.getByLabelText('Wallet name').props.value).toBe('Kept draft');
  const write = deferred<{ data: Wallet }>();
  post.mockReturnValueOnce(write.promise);
  await fireEvent.press(view.getByText('Add Wallet'));
  await waitFor(() => expect(view.getByText('Loading...')).toBeTruthy());
  await fireEvent.press(view.getByText('Back'));
  expect(view.getByLabelText('Wallet name').props.value).toBe('Kept draft');
  expect(post).toHaveBeenCalledTimes(2);
  await act(async () => {
    write.resolve({ data: wallet('c') });
    await write.promise;
  });
  await waitFor(() => expect(view.queryByLabelText('Wallet name')).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    url,
    expect.objectContaining({ name: 'Kept draft', address: '0x' + 'a'.repeat(40), signingPreference: 'hardware' }),
    { ledovaSessionEpoch: getSessionEpoch() },
  );
});

it('keeps name changes through refresh failures and refused saves, then displays the accepted name', async () => {
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByLabelText('Wallet name')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('Wallet name'), 'Kept name');
  failedPage = 2;
  await refresh();
  await waitFor(() =>
    expect(
      view.getByText('This wallet could not be loaded. Your changes are kept; retry before continuing.'),
    ).toBeTruthy(),
  );
  expect(view.queryByText('Verify address')).toBeNull();
  failedPage = null;
  await fireEvent.press(view.getByText('Try again'));
  await waitFor(() => expect(view.getByLabelText('Wallet name').props.value).toBe('Kept name'));
  patch.mockRejectedValueOnce(new Error('Fictional rename refused'));
  await fireEvent.press(view.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(view.getByText('Fictional rename refused')).toBeTruthy());
  expect(view.getByLabelText('Wallet name').props.value).toBe('Kept name');
  await fireEvent.press(view.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(view.getByText('Kept name')).toBeTruthy());
  expect(patch).toHaveBeenLastCalledWith(url + 'a/', { name: 'Kept name' }, { ledovaSessionEpoch: getSessionEpoch() });
  expect(mockBack).not.toHaveBeenCalled();
});

it("states the wallet's balance in its network's unit, to eight places, as the Wallets row does", async () => {
  pages[1].results[0] = { ...pages[1].results[0], chain: 'bitcoin', nativeBalance: '0.012500000000000000' };
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('0.0125 BTC')).toBeTruthy());
  expect(view.queryByText(/0\.0125000/)).toBeNull();
});

it('uses the complete current ledger rather than a stale route wallet after removal', async () => {
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Fictional a')).toBeTruthy());
  pages[1].results = [];
  await refresh();
  await waitFor(() => expect(view.getByText('This wallet is no longer in your account.')).toBeTruthy());
  expect(view.queryByText('Delete wallet')).toBeNull();
  expect(view.queryByText('Fictional a')).toBeNull();
});

it('resets detail drafts when navigation changes the selected wallet', async () => {
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByLabelText('Wallet name')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('Wallet name'), 'Draft for a');
  mockRouteWallet = wallet('b');
  await view.rerender(<WalletActionScreen />);
  await waitFor(() => expect(view.getByLabelText('Wallet name').props.value).toBe('Fictional b'));
});

it('awaits native copy success and preserves the exact full address after refusal', async () => {
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Copy address')).toBeTruthy());
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  await fireEvent.press(view.getByRole('button', { name: 'Copy address' }));
  await waitFor(() => expect(view.getByText('The address could not be copied. Try again.')).toBeTruthy());
  expect(view.queryByText('Copied address')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Copy address' }));
  await waitFor(() => expect(view.getByText('Copied address')).toBeTruthy());
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(wallet().address);
});

it('keeps refused deletion open and prevents cancel or duplicate confirmation while pending', async () => {
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Delete wallet')).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Delete wallet' }));
  remove.mockRejectedValueOnce(new Error('Fictional delete refused'));
  await fireEvent.press(view.getByText('Delete'));
  await waitFor(() => expect(view.getByText('Fictional delete refused')).toBeTruthy());
  expect(mockBack).not.toHaveBeenCalled();
  const write = deferred<{ data: null }>();
  remove.mockReturnValueOnce(write.promise);
  await fireEvent.press(view.getByText('Delete'));
  await waitFor(() => expect(view.getByText('Loading...')).toBeTruthy());
  await fireEvent.press(view.getByText('Cancel'));
  expect(view.getByText('Delete Wallet')).toBeTruthy();
  expect(remove).toHaveBeenCalledTimes(2);
  await act(async () => {
    pages[1].results = [];
    write.resolve({ data: null });
    await write.promise;
  });
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});

it('waits for each imported wallet and on retry skips only requests already confirmed successful', async () => {
  const first = deferred<{ data: Wallet }>();
  post
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error('Second refused'))
    .mockResolvedValue({ data: wallet('d') });
  const hook = await renderHook(
    () => {
      const crud = useWalletsCrud();
      return { crud, form: useWallets(crud) };
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current!.crud.isLoading).toBe(false));
  const addresses = ['c', 'd'].map(
    (letter, index) =>
      ({
        address: '0x' + letter.repeat(40),
        networkType: 'BASE',
        derivationPath: `m/44'/60'/0'/0/${index}`,
        addressIndex: index,
      }) as DerivedAddress,
  );
  const importData = { addresses, parentKeys: [], masterFingerprint: '00000000' } as HardwareWalletImport;
  await act(() => hook.result.current!.form.openAddModal());
  let request!: Promise<void>;
  await act(() => {
    request = hook.result.current!.form.handleBatchCreateWallets(addresses, importData);
  });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await act(() => hook.result.current!.form.closeAddModal());
  expect(hook.result.current!.form.showAddModal).toBe(true);
  await act(async () => {
    const failure = expect(request).rejects.toThrow('Second refused');
    first.resolve({ data: wallet('c') });
    await failure;
  });
  expect(hook.result.current!.form.showAddModal).toBe(true);
  expect(post).toHaveBeenCalledTimes(2);
  await act(async () => {
    await hook.result.current!.form.handleBatchCreateWallets(addresses, importData);
  });
  expect(post).toHaveBeenCalledTimes(3);
  expect(post.mock.calls.map((call) => (call[1] as { address: string }).address)).toEqual([
    addresses[0].address,
    addresses[1].address,
    addresses[1].address,
  ]);
  expect(hook.result.current!.form.showAddModal).toBe(false);
});

it('discards a creation response after the captured session is retired', async () => {
  const write = deferred<{ data: Wallet }>();
  post.mockReturnValue(write.promise);
  const hook = await renderHook(() => useWalletsCrud(), { wrapper });
  await waitFor(() => expect(hook.result.current!.isLoading).toBe(false));
  const captured = getSessionEpoch();
  let request!: Promise<unknown>;
  await act(() => {
    request = hook.result.current!.createWallet({ chain: 'base', address: wallet().address });
  });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await act(async () => {
    const failure = expect(request).rejects.toThrow('The saved session changed.');
    invalidateSessionScope();
    write.resolve({ data: wallet() });
    await failure;
  });
  expect(post).toHaveBeenCalledWith(url, expect.any(Object), { ledovaSessionEpoch: captured });
});

it('uses current verification for name and verify actions', async () => {
  pages[1].results[0].verificationStatus = 'PENDING';
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Verify the address before changing its name.')).toBeTruthy());
  expect(view.getByLabelText('Wallet name').props.editable).toBe(false);
  expect(view.getByRole('button', { name: 'Save name' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Verify address' }));
  expect(mockNavigate).toHaveBeenCalledWith('WalletVerification', { wallet: pages[1].results[0] });
  pages[1].results[0].verificationStatus = 'VERIFIED';
  await refresh();
  await waitFor(() => expect(view.getByRole('button', { name: 'Verify address' })).toBeDisabled());
});

it('prevents deriving an address already recorded on a later wallet page', async () => {
  const parent = {
    masterFingerprint: '00000000',
    parentPublicKey: 'synthetic-public-key',
    parentChainCode: 'synthetic-chain-code',
    parentDerivationPath: "m/44'/60'/0'/0",
    addressIndex: 0,
  };
  pages[1].results[0] = { ...pages[1].results[0], ...parent };
  pages[2].results[0] = { ...pages[2].results[0], ...parent, addressIndex: 1 };
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Derive address')).toBeTruthy());
  expect(view.getByRole('button', { name: 'Derive address' })).toBeDisabled();
  pages[2].results = [];
  await refresh();
  await waitFor(() => expect(view.getByRole('button', { name: 'Derive address' })).not.toBeDisabled());
});

it('keeps a refused derived-address preview and closes only after registration succeeds', async () => {
  const parent = {
    masterFingerprint: '00000000',
    parentPublicKey: 'synthetic-public-key',
    parentChainCode: 'synthetic-chain-code',
    parentDerivationPath: "m/44'/60'/0'/0",
    addressIndex: 0,
  };
  pages[1].results[0] = { ...pages[1].results[0], ...parent };
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Derive address')).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Derive address' }));
  expect(mockDerive).toHaveBeenCalledWith(
    parent.parentPublicKey,
    parent.parentChainCode,
    parent.parentDerivationPath,
    1,
  );
  post.mockRejectedValueOnce(new Error('Fictional derived registration refused'));
  await fireEvent.press(view.getByText('Add Address'));
  await waitFor(() => expect(view.getByText('Fictional derived registration refused')).toBeTruthy());
  expect(view.getByText('0x' + 'c'.repeat(40))).toBeTruthy();
  await fireEvent.press(view.getByText('Add Address'));
  await waitFor(() => expect(view.queryByText('Derive New Address')).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    url,
    expect.objectContaining({
      chain: 'base',
      address: '0x' + 'c'.repeat(40),
      signingPreference: 'hardware',
      addressIndex: 1,
      parentPublicKey: parent.parentPublicKey,
      parentChainCode: parent.parentChainCode,
      parentDerivationPath: parent.parentDerivationPath,
    }),
    { ledovaSessionEpoch: getSessionEpoch() },
  );
});

it('does not call unresolved account ownership an empty wallet list', async () => {
  mockPreferences = { ...mockPreferences, userAccount: null, isLoading: true };
  const view = await mount(<WalletsScreen />);
  expect(view.getByLabelText('Loading wallets')).toBeTruthy();
  expect(view.queryByText('No Base wallets yet.')).toBeNull();
  expect(get).not.toHaveBeenCalled();
  mockPreferences = { ...mockPreferences, isLoading: false, isError: true };
  await view.rerender(<WalletsScreen />);
  expect(view.getByText('Your wallets could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByText('No Base wallets yet.')).toBeNull();
  mockPreferences = { ...mockPreferences, userAccount: { uuid: 'owner' }, isError: false };
  await view.rerender(<WalletsScreen />);
  await waitFor(() => expect(view.getByText('Fictional b')).toBeTruthy());
});

it('retains an open delete confirmation through a failed read and retries inside the modal', async () => {
  const view = await mount(<WalletActionScreen />);
  await waitFor(() => expect(view.getByText('Delete wallet')).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Delete wallet' }));
  failedPage = 2;
  await refresh();
  await waitFor(() =>
    expect(view.getByText('Refresh wallets before continuing. Your selection is kept.')).toBeTruthy(),
  );
  expect(view.getByText('Delete')).toBeDisabled();
  expect(view.getByText('Delete Wallet')).toBeTruthy();
  failedPage = null;
  await fireEvent.press(view.getByText('Retry wallets'));
  await waitFor(() => expect(view.getByText('Delete')).not.toBeDisabled());
  expect(remove).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Delete'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});
