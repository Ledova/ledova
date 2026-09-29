import { useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { AppState, Pressable, Text } from 'react-native';
import { WALLET_ENDPOINTS } from '@ledova/shared';
import { CameraAccessContext, createCameraAccess } from '../../../contexts/cameraAccess';
import { apiClient } from '../../../services/apiClient';
import { BuyCryptoModal } from './BuyCryptoModal';

jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  getUserVerificationStatus: () => ({ type: 'verified' }),
  useCurrency: () => ({ formatDisplayCurrency: String }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

const wallet = (uuid: string, name: string) => ({
  uuid,
  name,
  address: `0x${uuid.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'VERIFIED',
  nativeBalance: '1',
  marketValue: '1',
});
const get = apiClient.get as jest.Mock;
let client: QueryClient;

beforeEach(() => {
  AppState.currentState = 'active';
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url !== WALLET_ENDPOINTS.BASE) return { data: { results: [{}], count: 1, next: null, previous: null } };
    return (config?.params?.page ?? 1) === 1
      ? {
          data: {
            results: [wallet('1', 'First wallet')],
            count: 2,
            next: 'https://example.test/api/wallets/?page=2',
            previous: null,
          },
        }
      : { data: { results: [wallet('2', 'Second wallet')], count: 2, next: null, previous: null } };
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

function show() {
  const access = createCameraAccess();
  access.setAllowed(true);
  return render(
    <CameraAccessContext.Provider value={access}>
      <QueryClientProvider client={client}>
        <BuyCryptoModal
          visible
          initialAsset="ETH"
          userAccountUuid="synthetic-account"
          onClose={jest.fn()}
          onNavigateToProfile={jest.fn()}
          onNavigateToWebView={jest.fn()}
        />
      </QueryClientProvider>
    </CameraAccessContext.Provider>,
  );
}

it('offers every verified wallet on the chosen network when they fill more than one page, rather than buying into the first', async () => {
  const view = await show();

  expect(await view.findByText('Second wallet')).toBeTruthy();
  expect(view.getByText('First wallet')).toBeTruthy();
  expect(view.getByText('Choose a wallet to receive Ethereum')).toBeTruthy();
  expect(
    get.mock.calls.filter(([url]) => url === WALLET_ENDPOINTS.BASE).map(([, config]) => config.params.page),
  ).toEqual([1, 2]);
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('lists each wallet as a Wallets row reads, with its status, signing preference, balance and value labelled', async () => {
  get.mockImplementation(async (url: string) =>
    url === WALLET_ENDPOINTS.BASE
      ? {
          data: {
            results: [
              { ...wallet('1', 'First wallet'), signingPreference: 'software' },
              {
                ...wallet('2', 'Second wallet'),
                signingPreference: 'hardware',
                nativeBalance: '0.42',
                marketValue: '2',
              },
            ],
            count: 2,
            next: null,
            previous: null,
          },
        }
      : { data: { results: [{}], count: 1, next: null, previous: null } },
  );
  const view = await show();

  const second = await view.findByRole('button', { name: /Second wallet/ });
  expect(within(second).getByText('0.42 ETH').parent).toBe(within(second).getByText('Balance').parent);
  expect(within(second).getByText('2').parent).toBe(within(second).getByText('Estimated value').parent);
  expect(
    within(second)
      .getAllByRole('img')
      .map((image) => image.props.accessibilityLabel),
  ).toEqual(['Wallet address verified', 'Hardware (self-declared)']);
  expect(within(second).queryByText(wallet('2', '').address)).toBeNull();
  const first = view.getByRole('button', { name: /First wallet/ });
  expect(within(first).getByText('1 ETH').parent).toBe(within(first).getByText('Balance').parent);
  expect(within(first).getByRole('img', { name: 'Software (self-declared)' })).toBeTruthy();
});

const LOAD_FAILED = 'Your wallets could not be loaded. Try again before continuing.';
const post = apiClient.post as jest.Mock;
type Page = { data: { results: unknown[]; count: number; next: null; previous: null } };
const page = (results: unknown[]): Page => ({ data: { results, count: results.length, next: null, previous: null } });
const walletCalls = () => get.mock.calls.filter(([url]) => url === WALLET_ENDPOINTS.BASE);

function answer(read: () => Promise<Page>) {
  get.mockImplementation(async (url: string) =>
    url === WALLET_ENDPOINTS.BASE ? read() : { data: { results: [{}], count: 1, next: null, previous: null } },
  );
}

function pending() {
  let settle!: (value: Page) => void;
  let refuse!: (error: Error) => void;
  const promise = new Promise<Page>((resolve, reject) => {
    settle = resolve;
    refuse = reject;
  });
  return {
    promise,
    settle: (value: Page) => act(async () => settle(value)),
    refuse: (error: Error) => act(async () => refuse(error)),
  };
}

function Reopenable({ navigate }: { navigate: (url: string) => void }) {
  const [open, setOpen] = useState(true);
  const [access] = useState(() => {
    const allowed = createCameraAccess();
    allowed.setAllowed(true);
    return allowed;
  });
  return (
    <CameraAccessContext.Provider value={access}>
      <QueryClientProvider client={client}>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
          <Text>Buy again</Text>
        </Pressable>
        <BuyCryptoModal
          visible={open}
          userAccountUuid="synthetic-account"
          onClose={() => setOpen(false)}
          onNavigateToProfile={jest.fn()}
          onNavigateToWebView={(url) => {
            setOpen(false);
            navigate(url);
          }}
        />
      </QueryClientProvider>
    </CameraAccessContext.Provider>
  );
}

type View = Awaited<ReturnType<typeof render>>;

async function chooseEthereum(view: View) {
  await waitFor(() => expect(view.getByText('Ethereum')).not.toBeDisabled());
  await fireEvent.press(view.getByText('Ethereum'));
}

async function boughtOnce(navigate: jest.Mock) {
  answer(async () => page([wallet('1', 'First wallet')]));
  post.mockResolvedValue({ data: { url: 'https://provider.example.test/buy' } });
  const view = await render(<Reopenable navigate={navigate} />);
  await chooseEthereum(view);
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  expect(view.queryByText('Ethereum')).toBeNull();
  return view;
}

async function buyAgain(view: View) {
  await fireEvent.press(view.getByRole('button', { name: 'Buy again' }));
  await chooseEthereum(view);
}

describe('Buy crypto acts only on a finished read', () => {
  it('waits for a fresh read before buying into the one wallet it read before, then goes straight to the widget', async () => {
    const navigate = jest.fn();
    const view = await boughtOnce(navigate);
    const read = pending();
    answer(() => read.promise);

    await buyAgain(view);
    await waitFor(() => expect(walletCalls()).toHaveLength(2));

    expect(view.getByText('Ethereum')).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
    await read.settle(page([wallet('1', 'First wallet')]));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('asks which wallet receives the asset when the fresh read finds two, rather than buying into the one it read before', async () => {
    const navigate = jest.fn();
    const view = await boughtOnce(navigate);
    const read = pending();
    answer(() => read.promise);

    await buyAgain(view);
    await read.settle(page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));

    expect(await view.findByRole('button', { name: /Second wallet/ })).not.toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('says the wallets could not be loaded when the fresh read fails, rather than buying into the one it read before', async () => {
    const navigate = jest.fn();
    const view = await boughtOnce(navigate);
    const read = pending();
    answer(() => read.promise);

    await buyAgain(view);
    await read.refuse(new Error('Request failed with status code 500'));

    expect(await view.findByRole('alert')).toHaveTextContent(LOAD_FAILED);
    expect(post).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('opens nothing for the one wallet it read before while offline, and asks when the read after reconnecting finds two', async () => {
    const navigate = jest.fn();
    const view = await boughtOnce(navigate);
    answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    await act(async () => onlineManager.setOnline(false));

    await buyAgain(view);
    await act(async () => {});

    expect(view.getByText('Ethereum')).toBeDisabled();
    expect(walletCalls()).toHaveLength(1);
    await act(async () => onlineManager.setOnline(true));

    expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('waits for its first read while offline, rather than saying there are none', async () => {
    answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    await act(async () => onlineManager.setOnline(false));
    const view = await render(<Reopenable navigate={jest.fn()} />);

    await chooseEthereum(view);
    await act(async () => {});

    expect(view.queryByText(/No verified wallets for/)).toBeNull();
    expect(view.getByText('Ethereum')).toBeDisabled();
    expect(walletCalls()).toHaveLength(0);
    await act(async () => onlineManager.setOnline(true));
    expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('lets no wallet it read before be chosen while offline', async () => {
    answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    const view = await render(<Reopenable navigate={jest.fn()} />);
    await chooseEthereum(view);
    await view.findByRole('button', { name: /Second wallet/ });
    await fireEvent.press(view.getByRole('button', { name: 'Back' }));
    await act(async () => onlineManager.setOnline(false));

    await chooseEthereum(view);

    expect(await view.findByRole('button', { name: /Second wallet/ })).toBeDisabled();
    expect(view.getByRole('button', { name: /First wallet/ })).toBeDisabled();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(view.getByRole('button', { name: /Second wallet/ })).not.toBeDisabled());
    expect(post).not.toHaveBeenCalled();
  });

  it('holds the wallets it listed before while it reads them again', async () => {
    answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    post.mockReturnValue(new Promise(() => {}));
    const view = await render(<Reopenable navigate={jest.fn()} />);
    await chooseEthereum(view);
    await view.findByRole('button', { name: /Second wallet/ });
    await fireEvent.press(view.getByRole('button', { name: 'Back' }));
    const read = pending();
    answer(() => read.promise);

    await chooseEthereum(view);

    const stale = await view.findByRole('button', { name: /Second wallet/ });
    expect(stale).toBeDisabled();
    await fireEvent.press(stale);
    expect(post).not.toHaveBeenCalled();
    await read.settle(page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    await waitFor(() => expect(view.getByRole('button', { name: /Second wallet/ })).not.toBeDisabled());
    await fireEvent.press(view.getByRole('button', { name: /Second wallet/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({ wallet_uuid: '2' });
  });

  it('says the wallets could not be loaded when the read fails, rather than that there are none, and tries again', async () => {
    answer(() => Promise.reject(new Error('Request failed with status code 500')));
    const view = await render(<Reopenable navigate={jest.fn()} />);
    await chooseEthereum(view);

    expect(await view.findByRole('alert')).toHaveTextContent(LOAD_FAILED);
    expect(view.queryByText(/No verified wallets for/)).toBeNull();
    expect(view.queryByText(/status code 500/)).toBeNull();
    answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));

    expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('hides the wallets it listed when a refresh fails, and holds Try again while it reads them again', async () => {
    answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
    const view = await render(<Reopenable navigate={jest.fn()} />);
    await chooseEthereum(view);
    await view.findByRole('button', { name: /Second wallet/ });
    answer(() => Promise.reject(new Error('Request failed with status code 500')));

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['wallets'] });
    });

    expect(await view.findByRole('alert')).toHaveTextContent(LOAD_FAILED);
    expect(view.queryByRole('button', { name: /Second wallet/ })).toBeNull();
    const read = pending();
    answer(() => read.promise);
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Try again' })).toBeDisabled());
    await read.settle(page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));

    expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});

it('holds every wallet while the chosen one opens the purchase, and marks only that one busy', async () => {
  answer(async () => page([wallet('1', 'First wallet'), wallet('2', 'Second wallet')]));
  post.mockReturnValue(new Promise(() => {}));
  const view = await render(<Reopenable navigate={jest.fn()} />);
  await chooseEthereum(view);
  await fireEvent.press(await view.findByRole('button', { name: /Second wallet/ }));

  await waitFor(() => expect(view.getByRole('button', { name: /Second wallet/ })).toBeBusy());
  const chosen = view.getByRole('button', { name: /Second wallet/ });
  const other = view.getByRole('button', { name: /First wallet/ });
  const spinners = (choice: typeof chosen) =>
    choice.children.filter((child) => typeof child !== 'string' && child.type === 'ActivityIndicator');
  expect(spinners(chosen)).toHaveLength(1);
  expect(other).not.toBeBusy();
  expect(spinners(other)).toHaveLength(0);
  expect(chosen).toBeDisabled();
  expect(other).toBeDisabled();
  await fireEvent.press(other);
  expect(post).toHaveBeenCalledTimes(1);
});

it.each([
  [
    'a refusal that gives its reason',
    { status: 400, data: { detail: 'Purchases are paused for this account.' } },
    'Purchases are paused for this account.',
  ],
  [
    'a refusal of one field',
    { status: 400, data: { walletUuid: ['This wallet cannot receive purchases.'] } },
    'This wallet cannot receive purchases.',
  ],
  [
    "a proxy's error page",
    { status: 502, data: '<html><body><h1>502 Bad Gateway</h1></body></html>' },
    'The purchase page could not be opened. Try again.',
  ],
] as const)(
  'says why the purchase page could not be opened after %s, and never the raw response',
  async (_, response, shown) => {
    answer(async () => page([wallet('1', 'First wallet')]));
    post.mockRejectedValue(
      Object.assign(new Error(`Request failed with status code ${response.status}`), { response }),
    );
    const view = await render(<Reopenable navigate={jest.fn()} />);
    await chooseEthereum(view);

    expect(await view.findByText(shown)).toBeTruthy();
    expect(view.queryByText(/Request failed with status code/)).toBeNull();
    expect(view.queryByText(/Bad Gateway/)).toBeNull();
  },
);
