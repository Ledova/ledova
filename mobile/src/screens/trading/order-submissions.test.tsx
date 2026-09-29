import { Action } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  DESIGN_TOKENS,
  USER_PREFERENCES_QUERY_KEY,
  TRADING_ENDPOINTS,
  OrderSubmission,
  createOrderSubmissionStore,
} from '@ledova/shared';
import { EthSignRequest, ETHSignature } from '@keystonehq/bc-ur-registry-eth';
import { QRDisplay, QRScanner } from '../../components/qr';
import { TradingScreen } from './index';
import { OrderSigningModal } from './components/OrderSigningModal';
import { getSeedPhrase } from '../../services/secureKeyStorage';
import { signEthereumTypedData } from '../../utils/softwareWallet/localSigner';
import { orderSubmissionStore } from '../../services/orderSubmissions';
import { invalidateSessionScope } from '../../services/sessionScope';
import {
  accountUuid,
  deferred,
  draft,
  memoryStorage,
  largeMinQuantity,
  largeQuantity,
  largeSnapshotJson,
  otherAccountUuid,
  owner,
  response,
  secondId,
  snapshot,
  submissionId,
  userUuid,
  wallet,
} from '../../../../packages/shared/tests/fixtures/order-submissions';

jest.mock('../../components/Ledger', () => {
  const actual = jest.requireActual('../../components/Ledger');
  return { ...actual, Action: jest.fn(actual.Action) };
});
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('uuid', () => ({ v4: () => '70000000-0000-4000-8000-000000000001' }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../../services/secureKeyStorage', () => ({ getSeedPhrase: jest.fn() }));
jest.mock('../../utils/softwareWallet/localSigner', () => ({ signEthereumTypedData: jest.fn() }));
jest.mock('../../components/qr', () => ({ QRDisplay: jest.fn(() => null), QRScanner: jest.fn(() => null) }));
const mockDialogLifecycle: string[] = [];
const dialogEvents = (event: string) => mockDialogLifecycle.filter((entry) => entry === event).length;
jest.mock('../../components/modal', () => {
  const { useEffect } = jest.requireActual('react');
  const { View, Text, Pressable } = jest.requireActual('react-native');
  function MockDialogContent({ children, tracked }: { children: React.ReactNode; tracked: boolean }) {
    useEffect(() => {
      if (!tracked) return;
      mockDialogLifecycle.push('content mounted');
      return () => {
        mockDialogLifecycle.push('content unmounted');
      };
    }, []);
    return <View>{children}</View>;
  }
  function MockCustomModal({
    visible,
    title,
    contentKey,
    children,
    actions,
    onClose,
    onConfirm,
    confirmLabel,
    confirmDisabled,
  }: {
    visible: boolean;
    title: string;
    contentKey?: React.Key;
    children: React.ReactNode;
    actions?: React.ReactNode;
    onClose: () => void;
    onConfirm?: () => void;
    confirmLabel?: string;
    confirmDisabled?: boolean;
  }) {
    const tracked = !/^(Wanted|For sale) · /.test(title);
    useEffect(() => {
      if (!tracked) return;
      mockDialogLifecycle.push('modal mounted');
      return () => {
        mockDialogLifecycle.push('modal unmounted');
      };
    }, []);
    return visible ? (
      <View>
        <MockDialogContent key={contentKey} tracked={tracked}>
          {children}
        </MockDialogContent>
        {actions}
        <Pressable onPress={onClose}>
          <Text>Dismiss window</Text>
        </Pressable>
        {onConfirm && (
          <Pressable disabled={confirmDisabled} onPress={onConfirm}>
            <Text>{confirmLabel}</Text>
          </Pressable>
        )}
      </View>
    ) : null;
  }
  return { ...jest.requireActual('../../components/modal'), CustomModal: jest.fn(MockCustomModal) };
});
jest.mock('./components/MarketList', () => ({ MarketList: () => null }));
jest.mock('./components/OrdersCard', () => ({ OrdersCard: () => null }));
jest.mock('./hooks/useTradingEvents', () => ({ useTradingEvents: () => {} }));
jest.mock('@ledova/shared', () => {
  const f = jest.requireActual('../../../../packages/shared/tests/fixtures/order-submissions');
  const tokens = [{ uuid: f.tokenUuid, name: 'Synthetic', symbol: 'SYN', lastPrice: '12.50' }];
  return {
    ...jest.requireActual('@ledova/shared'),
    useShareTokens: () => ({ data: tokens, refetch: jest.fn() }),
    useInvestorEligibilityQuery: () => ({ data: { isEligible: true } }),
    useOrderBook: () => ({ data: null }),
    useSwapOrdersMulti: () => ({ data: [], refetch: jest.fn() }),
  };
});
jest.mock('./useTrading', () => {
  const f = jest.requireActual('../../../../packages/shared/tests/fixtures/order-submissions');
  return {
    useUserTradingWallets: () => ({ wallets: [f.wallet], walletAddresses: [f.wallet.address] }),
    useWalletsWhitelistStatus: () => ({
      isWhitelisted: () => true,
      getStatus: () => ({ status: 'whitelisted' }),
      isLoading: false,
    }),
    useAllWalletTokenBalances: () => ({ getWalletsWithHoldings: () => [], refetch: jest.fn() }),
    useAllUserOrders: () => ({ orders: [], refetch: jest.fn() }),
  };
});

const endpoints = TRADING_ENDPOINTS.ORDERS;
const nativeSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
let client: QueryClient;
let api = axios.create();
let requests: InternalAxiosRequestConfig[];
let handler: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
function setAccount(account = accountUuid) {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: userUuid, userAccount: { uuid: account } },
  });
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function creates() {
  return requests.filter((config) => config.url === endpoints.CREATE);
}
function messages() {
  return requests.filter((config) => config.url === endpoints.CREATE_MESSAGE);
}
async function draftForm(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByText('New buy order — SYN'));
  await fireEvent.changeText(view.getByPlaceholderText('Enter number of shares'), '10');
}
async function newOrder(view: Awaited<ReturnType<typeof render>>) {
  await draftForm(view);
  await fireEvent.press(view.getByText('Buy'));
  await waitFor(() => expect(view.getByText('Sign with biometric')).toBeTruthy());
}
beforeEach(async () => {
  mockDialogLifecycle.length = 0;
  wallet.signingPreference = 'software';
  jest.mocked(AsyncStorage.setItem).mockImplementation(nativeSet);
  await AsyncStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  setAccount();
  api = axios.create();
  requests = [];
  handler = async (config) => {
    const id = config.data ? JSON.parse(config.data).submission_id : config.url!.split('/').at(-2);
    return response(
      config,
      snapshot(id, config.url === endpoints.CREATE || config.method === 'get' ? 'created' : 'pending'),
      config.url === endpoints.CREATE ? 201 : 200,
    );
  };
  api.defaults.adapter = async (config) => {
    requests.push(config);
    return handler(config);
  };
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValueOnce(submissionId).mockReturnValueOnce(secondId);
  jest.mocked(getSeedPhrase).mockResolvedValue('synthetic-seed');
  jest.mocked(signEthereumTypedData).mockResolvedValue('synthetic-signature');
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('uses real draft and biometric callbacks and recovers a lost response across restart', async () => {
  const actual = handler;
  handler = async (config) => {
    if (config.url === endpoints.CREATE) throw new Error('Response lost');
    return actual(config);
  };
  const view = await render(<TradingScreen />, { wrapper });
  await newOrder(view);
  await fireEvent.press(view.getByText('Sign with biometric'));
  expect(view.getByText('Order status unconfirmed')).toBeTruthy();
  expect(creates()).toHaveLength(1);
  expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
  await view.unmount();
  const restarted = await render(<TradingScreen />, { wrapper });
  await waitFor(() => expect(restarted.getByText('Check saved order 1')).toBeTruthy());
  await fireEvent.press(restarted.getByText('Check saved order 1'));
  await waitFor(() => expect(restarted.getByText('Order recovered')).toBeTruthy());
  expect(restarted.getByText('Current status: Cancelled')).toBeTruthy();
  expect(messages()).toHaveLength(1);
  expect(getSeedPhrase).toHaveBeenCalledTimes(1);
  expect(signEthereumTypedData).toHaveBeenCalledTimes(1);
  expect(await orderSubmissionStore.list(owner)).toHaveLength(0);
}, 15_000);

it('keeps one mounted signing dialog while the order is prepared, signed and created', async () => {
  const held: (() => void)[] = [];
  const created = handler;
  handler = (config) => new Promise((resolve) => held.push(() => resolve(created(config))));
  const release = async () => {
    await waitFor(() => expect(held).toHaveLength(1));
    await act(async () => held.shift()!());
  };
  const view = await render(<TradingScreen />, { wrapper });
  await draftForm(view);
  await fireEvent.press(view.getByText('Buy'));
  await waitFor(() => expect(view.getByText('Checking order and preparing signing details...')).toBeTruthy());
  await release();
  await fireEvent.press(await view.findByText('Sign with biometric'));
  await waitFor(() =>
    expect(
      view.getByText('Submitting this order. You can close this window and check its status from saved orders.'),
    ).toBeTruthy(),
  );
  await release();
  await waitFor(() => expect(view.getByText('Order created')).toBeTruthy());
  expect(dialogEvents('modal mounted')).toBe(1);
  expect(dialogEvents('modal unmounted')).toBe(0);
  expect(dialogEvents('content mounted')).toBe(3);
  expect(jest.mocked(CustomModal).mock.calls.every(([props]) => props.visible)).toBe(true);
});

it('states an unconfirmed order in plain text, as the web does', async () => {
  const actual = handler;
  handler = async (config) => {
    if (config.url === endpoints.CREATE) throw new Error('Response lost');
    return actual(config);
  };
  const view = await render(<TradingScreen />, { wrapper });
  await newOrder(view);
  await fireEvent.press(view.getByText('Sign with biometric'));
  const [, message] = view.getByText('Order status unconfirmed').parent!.children;
  expect(message).toHaveStyle({ color: DESIGN_TOKENS.colors.text.primary });
});

it.each(['close', 'unmount', 'account', 'session'])(
  'does not sign after a seed read resolves following %s',
  async (transition) => {
    const seed = deferred<string>();
    jest.mocked(getSeedPhrase).mockReturnValue(seed.promise);
    const view = await render(<TradingScreen />, { wrapper });
    await newOrder(view);
    await fireEvent.press(view.getByText('Sign with biometric'));
    expect(getSeedPhrase).toHaveBeenCalledTimes(1);
    if (transition === 'close') await fireEvent.press(view.getByText('Dismiss window'));
    if (transition === 'unmount') await view.unmount();
    if (transition === 'account')
      await act(async () => {
        setAccount(otherAccountUuid);
      });
    if (transition === 'session')
      await act(async () => {
        invalidateSessionScope();
      });
    await act(async () => {
      seed.resolve('synthetic-late-seed');
    });
    expect(signEthereumTypedData).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(0);
    expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
  },
);

it('latches draft presses, and an account change while persisting prevents the first HTTP request', async () => {
  const stored = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  const entered = deferred<void>();
  const release = deferred<void>();
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    entered.resolve();
    await release.promise;
    return stored(key, value);
  });
  const view = await render(<TradingScreen />, { wrapper });
  await draftForm(view);
  const confirm = jest
    .mocked(Action)
    .mock.calls.filter(([props]) => props.label === 'Buy')
    .at(-1)![0].onPress;
  await act(async () => {
    confirm();
    confirm();
  });
  await entered.promise;
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  await act(async () => {
    setAccount(otherAccountUuid);
  });
  await act(async () => {
    release.resolve();
  });
  expect(messages()).toHaveLength(0);
  expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
  await act(async () => {
    setAccount();
  });
  await waitFor(() => expect(view.getByText('Check saved order 1')).toBeTruthy());
});

it('keeps two equal explicit orders when the first create is still pending', async () => {
  const post = deferred<AxiosResponse>();
  const actual = handler;
  handler = async (config) => (config.url === endpoints.CREATE ? post.promise : actual(config));
  const view = await render(<TradingScreen />, { wrapper });
  await newOrder(view);
  await fireEvent.press(view.getByText('Sign with biometric'));
  await waitFor(() => expect(creates()).toHaveLength(1));
  await fireEvent.press(view.getByText('Dismiss window'));
  await newOrder(view);
  expect(messages().map((c) => JSON.parse(c.data).submission_id)).toEqual([submissionId, secondId]);
  expect(await orderSubmissionStore.list(owner)).toHaveLength(2);
  await act(async () => {
    post.resolve({ status: 201, data: snapshot(submissionId, 'created') } as AxiosResponse);
  });
  expect(view.queryByText('Order created')).toBeNull();
  expect(view.getByText('Sign with biometric')).toBeTruthy();
  expect(await orderSubmissionStore.list(owner)).toHaveLength(2);
});

it('keeps the draft open and sends nothing when persistence rejects', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('Storage unavailable'));
  const view = await render(<TradingScreen />, { wrapper });
  await draftForm(view);
  await fireEvent.press(view.getByText('Buy'));
  expect(view.getAllByText('The order could not be saved on this device. No signing request was sent.')).toHaveLength(
    2,
  );
  expect(view.getByPlaceholderText('Enter number of shares')).toBeTruthy();
  expect(messages()).toHaveLength(0);
  expect(creates()).toHaveLength(0);
});

it.each([true, false])(
  'recovers an expired challenge before seed access and keeps an absent result unresolved (found=%s)',
  async (found) => {
    handler = async (config) => {
      const data = snapshot();
      if (config.method === 'get') {
        if (!found)
          throw new AxiosError(
            'Missing',
            undefined,
            config,
            undefined,
            response(config, { detail: 'Not found.' }, 404),
          );
        data.challenge = null;
      } else if (messages().length === 1) data.challenge!.expiresAt = '2000-01-01T00:00:00Z';
      return response(config, data);
    };
    const view = await render(<TradingScreen />, { wrapper });
    await newOrder(view);
    await fireEvent.press(view.getByText('Sign with biometric'));
    await waitFor(() =>
      expect(view.getByText(found ? 'Sign with biometric' : 'Order status unconfirmed')).toBeTruthy(),
    );
    expect(getSeedPhrase).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(0);
    expect(messages()).toHaveLength(found ? 2 : 1);
    expect(requests.filter((c) => c.method === 'get').map((c) => c.url)).toEqual([endpoints.SUBMISSION(submissionId)]);
    expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
  },
);

it('retains real typed QR encoding and decoding while refusing a callback retained from a closed order', async () => {
  wallet.signingPreference = 'hardware';
  const view = await render(<TradingScreen />, { wrapper });
  await draftForm(view);
  await fireEvent.press(view.getByText('Buy'));
  await waitFor(() => expect(view.getByText('Show signing code')).toBeTruthy());
  await fireEvent.press(view.getByText('Show signing code'));
  const cbor = jest.mocked(QRDisplay).mock.calls.at(-1)![0].data;
  if (typeof cbor !== 'string') throw new Error('Expected the rendered QR to contain encoded CBOR hex.');
  const encoded = EthSignRequest.fromCBOR(Buffer.from(cbor, 'hex'));
  const payload = JSON.parse(encoded.getSignData().toString());
  expect(Object.keys(payload).sort()).toEqual(['domain', 'message', 'types']);
  expect(payload.message).toMatchObject({ submissionId, ownerAccountUuid: accountUuid, walletUuid: wallet.uuid });
  await fireEvent.press(view.getByText("I've signed it"));
  const firstScan = jest
    .mocked(QRScanner)
    .mock.calls.filter(([props]) => props.visible)
    .at(-1)![0].onScan;
  const dismiss = jest
    .mocked(QRScanner)
    .mock.calls.filter(([props]) => props.visible)
    .at(-1)![0].onClose;
  await act(async () => {
    dismiss();
  });
  await fireEvent.press(view.getByText('Dismiss window'));
  await draftForm(view);
  await fireEvent.press(view.getByText('Buy'));
  await waitFor(() => expect(view.getByText('Show signing code')).toBeTruthy());
  const signature = new ETHSignature(Buffer.alloc(65, 1)).toUREncoder(400).nextPart();
  await act(async () => {
    firstScan(signature);
  });
  expect(creates()).toHaveLength(0);
  await fireEvent.press(view.getByText('Show signing code'));
  await fireEvent.press(view.getByText("I've signed it"));
  const secondScan = jest
    .mocked(QRScanner)
    .mock.calls.filter(([props]) => props.visible)
    .at(-1)![0].onScan;
  await act(async () => {
    secondScan(signature);
    secondScan(signature);
  });
  await waitFor(() => expect(view.getByText('Order created')).toBeTruthy());
  expect(creates()).toHaveLength(1);
  expect(JSON.parse(creates()[0].data)).toMatchObject({ submission_id: secondId, signature: '0x' + '01'.repeat(65) });
  expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
});

it('keeps the reserved identity when retrying a failed persistence attempt in the same draft', async () => {
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Temporary storage failure'));
  const view = await render(<TradingScreen />, { wrapper });
  await draftForm(view);
  await fireEvent.press(view.getByText('Buy'));
  expect(messages()).toHaveLength(0);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('Buy'));
  await waitFor(() => expect(view.getByText('Sign with biometric')).toBeTruthy());
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(JSON.parse(messages()[0].data).submission_id).toBe(submissionId);
  expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
});

it('displays and retries exact recovered quantities above the safe integer range', async () => {
  await orderSubmissionStore.create(owner, wallet.uuid);
  handler = async (config) => {
    if (config.url === endpoints.CREATE && creates().length === 1) throw new Error('Response lost');
    const body = JSON.parse(
      largeSnapshotJson(config.url === endpoints.CREATE ? 'created' : 'pending', config.method !== 'get'),
    );
    if (body.order) body.order.quantity = Number(largeQuantity);
    return response(config, JSON.stringify(body), config.url === endpoints.CREATE ? 201 : 200);
  };
  const view = await render(<TradingScreen />, { wrapper });
  await waitFor(() => expect(view.getByText('Check saved order 1')).toBeTruthy());
  await fireEvent.press(view.getByText('Check saved order 1'));
  await waitFor(() => expect(view.getByText(`BUY ${largeQuantity} shares`)).toBeTruthy());
  expect(view.getByText(`Minimum fill: ${largeMinQuantity} shares`)).toBeTruthy();
  expect(view.getByText('Price per share: AUD 12.50')).toBeTruthy();
  await fireEvent.press(view.getByText('Sign with biometric'));
  expect(view.getByText('Order status unconfirmed')).toBeTruthy();
  expect(await orderSubmissionStore.list(owner)).toHaveLength(1);
  await fireEvent.press(view.getByText('Check order status'));
  await waitFor(() => expect(view.getByText(`BUY ${largeQuantity} shares`)).toBeTruthy());
  expect(view.getByText(`Minimum fill: ${largeMinQuantity} shares`)).toBeTruthy();
  await fireEvent.press(view.getByText('Sign with biometric'));
  await waitFor(() => expect(view.getByText('Order created')).toBeTruthy());
  expect(view.getByText('Recorded shares: Unavailable')).toBeTruthy();
  expect(messages()).toHaveLength(2);
  expect(creates()).toHaveLength(2);
  for (const config of [...messages(), ...creates()])
    expect(JSON.parse(config.data)).toMatchObject({
      submission_id: submissionId,
      quantity: largeQuantity,
      min_quantity: largeMinQuantity,
    });
  expect(signEthereumTypedData).toHaveBeenCalledTimes(2);
  for (const call of jest.mocked(signEthereumTypedData).mock.calls)
    expect(call[4]).toMatchObject({ quantity: largeQuantity, minQuantity: largeMinQuantity });
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(await orderSubmissionStore.list(owner)).toHaveLength(0);
});

async function readySubmissionPair() {
  const ids = [submissionId, secondId];
  const store = createOrderSubmissionStore(memoryStorage().storage, () => ids.shift()!);
  handler = async (config) => {
    const id = JSON.parse(config.data).submission_id;
    const created = config.url === endpoints.CREATE;
    const data = snapshot(id, created ? 'created' : 'pending');
    if (data.order)
      data.order.uuid =
        id === submissionId ? '60000000-0000-4000-8000-000000000001' : '60000000-0000-4000-8000-000000000002';
    return response(config, data, created ? 201 : 200);
  };
  const prepare = async () => {
    const record = await store.create(owner, wallet.uuid);
    const submission = new OrderSubmission(record, {
      apiClient: api,
      store,
      isCurrent: () => true,
      onSettled: () => {},
      onRecordsChanged: () => {},
    });
    await submission.start(draft);
    expect(submission.getSnapshot().phase).toBe('ready');
    return submission;
  };
  return { first: await prepare(), second: await prepare(), store };
}

it('delivers each S1 success once when the open wrapper switches directly between saved submissions', async () => {
  const { first, second, store } = await readySubmissionPair();
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  const props = { visible: true, wallet, onClose, onSuccess };
  const view = await render(<OrderSigningModal {...props} submission={first} />);
  await fireEvent.press(view.getByText('Sign with biometric'));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  first.close();
  await view.rerender(<OrderSigningModal {...props} submission={second} />);
  await fireEvent.press(view.getByText('Sign with biometric'));
  await waitFor(() => expect(view.getByText('Order created')).toBeTruthy());
  expect(creates().map((request) => JSON.parse(request.data).submission_id)).toEqual([submissionId, secondId]);
  expect(onSuccess.mock.calls.map(([order]) => order.uuid)).toEqual([
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
  ]);
  await view.rerender(<OrderSigningModal {...props} submission={second} />);
  expect(onSuccess).toHaveBeenCalledTimes(2);
  expect(onClose).not.toHaveBeenCalled();
  expect(await store.list(owner)).toHaveLength(0);
});

it('does not round an unsafe recorded quantity when recovering a completed order', async () => {
  await orderSubmissionStore.create(owner, wallet.uuid);
  handler = async (config) => {
    const body = JSON.parse(largeSnapshotJson('created', false));
    body.order.quantity = Number(largeQuantity);
    return response(config, JSON.stringify(body));
  };
  const view = await render(<TradingScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Check saved order 1'));
  await waitFor(() => expect(view.getByText('Order recovered')).toBeTruthy());
  expect(view.getByText('Recorded shares: Unavailable')).toBeTruthy();
  expect(creates()).toHaveLength(0);
  expect(signEthereumTypedData).not.toHaveBeenCalled();
});
