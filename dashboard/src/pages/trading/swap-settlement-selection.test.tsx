// @vitest-environment jsdom

import type { PropsWithChildren, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import {
  selectSwapSettlement,
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  type SwapOrder,
  type SwapSettlementResponse,
  type Wallet,
} from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { swapSettlementStore } from '@services/swapSettlements';
import * as localSigner from '@utils/softwareWallet/localSigner';
import tradingApi from '@services/apiClient';
import { TradingPage } from './index';
import fixture from '../../../../packages/shared/tests/fixtures/swap-settlement-api.json';
import { settlementListRow } from '../../../../packages/shared/tests/fixtures/swap-settlements';
import { deferred, response, userUuid } from '../../../../packages/shared/tests/fixtures/order-submissions';

const state = vi.hoisted(() => ({ wallets: [] as Wallet[], swaps: [] as SwapOrder[] }));
vi.mock('@components/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
vi.mock('@components/SeedPhraseInput', () => ({
  SeedPhraseInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Synthetic seed" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock('@components/qr', () => ({
  useQRScanner: () => ({ error: null, stopScanner: () => {} }),
  QRScannerView: () => null,
}));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => null }));
vi.mock('./components/MarketOverview', () => ({ MarketOverview: () => null }));
vi.mock('./components/PlaceOrderPanel', () => ({ PlaceOrderPanel: () => null }));
vi.mock('./components/OrderSigningFlow', () => ({ OrderSigningFlow: () => null }));
vi.mock('./hooks/useTradingEvents', () => ({ useTradingEvents: () => {} }));
vi.mock('./hooks/useAtomicSwaps', () => ({ useSwapOrdersMulti: () => ({ data: state.swaps, isLoading: false }) }));
vi.mock('./useTrading', () => ({
  useShareTokens: () => ({
    data: [{ uuid: '30ca2374-1201-459b-93b0-6eb8c1a90492', name: 'Synthetic', symbol: 'DEP' }],
    isLoading: false,
  }),
  useInvestorEligibilityQuery: () => ({ data: { isEligible: true } }),
  useUserTradingWallets: () => ({
    wallets: state.wallets,
    actionWallets: state.wallets,
    walletAddresses: state.wallets.map((wallet) => wallet.address),
  }),
  useWalletsWhitelistStatus: () => ({
    isWhitelisted: () => true,
    getStatus: () => ({ status: 'whitelisted' }),
    isLoading: false,
  }),
  useOrderBook: () => ({ data: null, isLoading: false }),
  useTrading: () => ({ userOrders: [], isLoadingUserOrders: false, getWalletsWithHoldings: () => [] }),
}));

const captured = fixture.get_body as SwapSettlementResponse;
const listed = Object.keys(
  (
    await vi.importActual<{ default: { components: { schemas: { SwapOrderList: { properties: object } } } } }>(
      '../../../../backend/schema/openapi.json',
    )
  ).default.components.schemas.SwapOrderList.properties,
);
const listShape = (swap: object, keys = listed) =>
  Object.fromEntries(Object.entries(swap).filter(([key]) => keys.includes(key))) as unknown as SwapOrder;
const listedSwap = settlementListRow(captured);
const owner = { userUuid, ownerAccountUuid: captured.ownerAccountUuid };
let client: QueryClient;
let requests: InternalAxiosRequestConfig[];
let api = axios.create();

function walletFor(role: 'seller' | 'buyer'): Wallet {
  const party = captured.swapOrder.settlementContext[role];
  return {
    uuid: party.walletUuid,
    userAccount: party.ownerAccountUuid,
    address: party.address,
    chain: 'base',
    verificationStatus: 'VERIFIED',
    verificationChallenge: null,
    verificationSignature: null,
    verifiedAt: null,
    lastSyncedAt: null,
    signingPreference: 'software',
    derivationPath: fixture.paths[role === 'seller' ? 0 : 1]!,
    masterFingerprint: '12345678',
    createdAt: captured.swapOrder.createdAt,
    updatedAt: captured.swapOrder.createdAt,
    nativeBalance: '0',
    nativeMarketValue: '0',
    marketValue: '0',
  };
}
function setAccount(account = owner.ownerAccountUuid) {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: userUuid, userAccount: { uuid: account } },
  });
}
function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function swapRequests() {
  return requests.filter((request) => request.url?.includes('/swap/'));
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(captured.swapOrder.createdAt) + 1000);
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  setAccount();
  state.wallets = [walletFor('buyer')];
  state.swaps = [settlementListRow(captured)];
  requests = [];
  api = axios.create();
  api.defaults.adapter = async (config) => {
    config.ledovaSubmissionGuard?.();
    requests.push(config);
    if (!config.url?.includes('/swap/'))
      return response(config, client.getQueryData<{ data: unknown }>(USER_PREFERENCES_QUERY_KEY)!.data);
    const userRole =
      config.params?.wallet_uuid === captured.swapOrder.settlementContext.seller.walletUuid ? 'seller' : 'buyer';
    const party = captured.swapOrder.settlementContext[userRole];
    const row = state.swaps.find((swap) => swap.uuid === config.params?.swap_uuid);
    const swapOrder = {
      ...captured.swapOrder,
      status: row?.status ?? captured.swapOrder.status,
      sellerHasSigned: row?.sellerHasSigned ?? captured.swapOrder.sellerHasSigned,
      buyerHasSigned: row?.buyerHasSigned ?? captured.swapOrder.buyerHasSigned,
    };
    const hasSigned = userRole === 'seller' ? swapOrder.sellerHasSigned : swapOrder.buyerHasSigned;
    const body = {
      ...captured,
      swapOrder,
      userRole,
      orderUuid: party.orderUuid,
      walletUuid: party.walletUuid,
      hasSigned,
      canSign: !hasSigned,
    };
    if (config.method === 'post') {
      const order = { ...swapOrder, buyerHasSigned: true, status: 'buyer_signed' as const };
      state.swaps = state.swaps.map((candidate) =>
        candidate.uuid === order.uuid ? { ...candidate, buyerHasSigned: true, status: order.status } : candidate,
      );
      return response(config, order);
    }
    if (config.url.endsWith('/approval-status/'))
      return response(config, {
        ...body,
        tokenAddress: captured.typedData.message.paymentToken,
        tokenSymbol: 'TUSD',
        requiredAmount: captured.typedData.message.paymentAmount,
        currentAllowance: ((1n << 256n) - 1n).toString(),
        needsApproval: false,
        spender: captured.typedData.domain.verifyingContract,
      });
    return response(config, body);
  };
});
afterEach(async () => {
  await cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('opens the buyer original order from a real list row before displaying exact captured quantities', async () => {
  render(<TradingPage />, { wrapper });
  expect(screen.getByText('Review trade amounts')).toBeTruthy();
  expect(screen.getByText('Buyer')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Sign swap'));
  await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
  expect(swapRequests()).toHaveLength(1);
  expect(swapRequests()[0]!.url).toContain(`/orders/${captured.swapOrder.buyOrderUuid}/swap/`);
  expect(swapRequests()[0]!.params).toMatchObject({
    wallet_uuid: captured.swapOrder.settlementContext.buyer.walletUuid,
    owner_account_uuid: captured.ownerAccountUuid,
    swap_uuid: captured.swapUuid,
  });
  expect(swapRequests()[0]!.params).not.toHaveProperty('settlement_digest');
});

it('keeps the unsigned buyer side available when both wallets are owned and the seller has already signed', async () => {
  state.wallets = [walletFor('seller'), walletFor('buyer')];
  state.swaps = [{ ...listedSwap, sellerHasSigned: true, status: 'seller_signed' }];
  render(<TradingPage />, { wrapper });
  fireEvent.click(screen.getByTitle('Sign swap'));
  await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
  expect(swapRequests()[0]!.url).toContain(`/orders/${captured.swapOrder.buyOrderUuid}/swap/`);
});

it.each([
  { name: 'missing viewer identities', swap: listShape(captured.swapOrder) },
  { name: 'empty viewer identities', swap: { ...listedSwap, viewerParties: [] } },
  {
    name: 'missing protocol version',
    swap: { ...listedSwap, settlementProtocolVersion: undefined, viewerParties: [] },
  },
])('offers no signing action for a list row with $name', ({ swap }) => {
  state.swaps = [swap as SwapOrder];
  render(<TradingPage />, { wrapper });
  expect(screen.queryByText('Held for operator review')).toBeNull();
  expect(screen.queryByTitle('Sign swap')).toBeNull();
  expect(swapRequests()).toEqual([]);
});

it.each([
  { status: 'created', role: 'buyer', signed: {} },
  { status: 'seller_signed', role: 'buyer', signed: { sellerHasSigned: true } },
  { status: 'buyer_signed', role: 'seller', signed: { buyerHasSigned: true } },
] as const)(
  'holds a $status version0 swap for the $role once the swap list carries its protocol version',
  ({ status, role, signed }) => {
    state.wallets = [walletFor(role)];
    state.swaps = [listShape({ ...captured.swapOrder, ...signed, status, settlementProtocolVersion: 0 })];
    render(<TradingPage />, { wrapper });
    const row = screen.getByText('Held for operator review').parentElement!;
    expect(within(row).getByText(role === 'seller' ? 'Seller' : 'Buyer')).toBeTruthy();
    expect(within(row).queryAllByRole('button')).toEqual([]);
  },
);

it('holds explicit version0 history and opens a refreshed version1 list row without signing', async () => {
  const signer = vi.spyOn(localSigner, 'signEthereumTypedData');
  const legacy = listShape({ ...captured.swapOrder, settlementProtocolVersion: 0 });
  state.swaps = [legacy];
  const view = render(<TradingPage />, { wrapper });
  expect(screen.queryByTitle('Sign swap')).toBeNull();
  expect(screen.getByText(`${legacy.shareAmount}@$${(legacy.paymentAmount / 100).toFixed(2)}`)).toBeTruthy();
  expect(screen.getByText('Buyer')).toBeTruthy();
  expect(screen.queryByText('Expired')).toBeNull();
  fireEvent.click(screen.getByText('Held for operator review'));
  await act(async () => {});
  expect(screen.queryByRole('alert')).toBeNull();
  state.swaps = [listedSwap];
  view.rerender(<TradingPage />);
  expect(screen.queryByText('Held for operator review')).toBeNull();
  expect(screen.getByText('Expired')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Sign swap'));
  await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
  expect(swapRequests()).toHaveLength(1);
  expect(swapRequests()[0]!.params).not.toHaveProperty('settlement_digest');
  expect(requests.filter((request) => request.method === 'post')).toEqual([]);
  expect(signer).not.toHaveBeenCalled();
});

it('lists multiple scoped reminders and recovers the exact selected identity without any submission', async () => {
  const signature = {
    version: 1 as const,
    ...owner,
    orderUuid: captured.swapOrder.settlementContext.buyer.orderUuid,
    walletUuid: captured.swapOrder.settlementContext.buyer.walletUuid,
    swapUuid: captured.swapUuid,
    settlementDigest: captured.settlementDigest,
    kind: 'signature' as const,
    signerAddress: captured.typedData.message.buyer.toLowerCase(),
  };
  const approval = { ...signature, kind: 'approval' as const, txHash: `0x${'ab'.repeat(32)}` };
  const { signerAddress: removed, ...savedApproval } = approval;
  expect(removed).toBe(signature.signerAddress);
  await swapSettlementStore.save(signature);
  await swapSettlementStore.save(savedApproval);
  await swapSettlementStore.save({ ...signature, userUuid: '10000000-0000-4000-8000-000000000099' });
  const records = await swapSettlementStore.list(owner);
  render(<TradingPage />, { wrapper });
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /Check saved (trade signature|approval)/ })).toHaveLength(2),
  );
  for (const [index, record] of records.entries()) {
    fireEvent.click(
      screen.getByText(`Check saved ${record.kind === 'approval' ? 'approval' : 'trade signature'} ${index + 1}`),
    );
    await waitFor(() => expect(swapRequests()).toHaveLength((index + 1) * 2));
    await waitFor(() => expect(screen.getByText('Check token approval')).toBeTruthy());
    const [context, outcome] = swapRequests().slice(index * 2, index * 2 + 2);
    for (const request of [context!, outcome!]) {
      expect(request.params).toMatchObject({
        swap_uuid: record.swapUuid,
        wallet_uuid: record.walletUuid,
        owner_account_uuid: record.ownerAccountUuid,
        settlement_digest: record.settlementDigest,
      });
      expect(request.url).toContain(`/orders/${record.orderUuid}/swap/`);
    }
    expect(context!.params).not.toHaveProperty('approval_tx_hash');
    expect(outcome!.params.approval_tx_hash).toBe(savedApproval.txHash);
  }
  expect(await swapSettlementStore.list(owner)).toHaveLength(2);
  expect(requests.filter((request) => request.method === 'post')).toEqual([]);
});

it.each(['wallet', 'account'] as const)(
  'a temporary %s change retires the mounted signer even when restored before it finishes',
  async (change) => {
    const signed = deferred<string>();
    const signer = vi.spyOn(localSigner, 'signEthereumTypedData').mockReturnValue(signed.promise);
    const view = render(<TradingPage />, { wrapper });
    fireEvent.click(screen.getByTitle('Sign swap'));
    await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
    fireEvent.click(screen.getByText('Check token approval'));
    await waitFor(() => expect(screen.getByText('Continue to sign')).toBeTruthy());
    fireEvent.click(screen.getByText('Continue to sign'));
    fireEvent.change(screen.getByLabelText('Synthetic seed'), { target: { value: fixture.mnemonic } });
    fireEvent.click(screen.getByText('Sign trade'));
    await waitFor(() => expect(signer).toHaveBeenCalledOnce());
    if (change === 'wallet') {
      state.wallets = [{ ...state.wallets[0]!, masterFingerprint: '87654321' }];
      view.rerender(<TradingPage />);
      state.wallets = [walletFor('buyer')];
      view.rerender(<TradingPage />);
    } else {
      act(() => setAccount('20000000-0000-4000-8000-000000000099'));
      act(() => setAccount());
    }
    await act(async () => {
      signed.resolve(fixture.signatures[1]!);
      await signed.promise;
    });
    expect(requests.filter((request) => request.method === 'post')).toEqual([]);
    expect(await swapSettlementStore.list(owner)).toEqual([]);
    expect(screen.queryByText('You are the buyer.')).toBeNull();
  },
);

it('latches a wallet cache change and restoration within one React batch before a signer finishes', async () => {
  const key = ['wallets', owner.ownerAccountUuid, 'trading'];
  const original = { data: { results: state.wallets } };
  client.setQueryData(key, original);
  const signed = deferred<string>();
  const signer = vi.spyOn(localSigner, 'signEthereumTypedData').mockReturnValue(signed.promise);
  render(<TradingPage />, { wrapper });
  fireEvent.click(screen.getByTitle('Sign swap'));
  await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
  fireEvent.click(screen.getByText('Check token approval'));
  await waitFor(() => expect(screen.getByText('Continue to sign')).toBeTruthy());
  fireEvent.click(screen.getByText('Continue to sign'));
  fireEvent.change(screen.getByLabelText('Synthetic seed'), { target: { value: fixture.mnemonic } });
  fireEvent.click(screen.getByText('Sign trade'));
  await waitFor(() => expect(signer).toHaveBeenCalledOnce());
  act(() => {
    client.setQueryData(key, { data: { results: [{ ...state.wallets[0]!, masterFingerprint: '87654321' }] } });
    client.setQueryData(key, original);
  });
  await act(async () => {
    signed.resolve(fixture.signatures[1]!);
    await signed.promise;
  });
  expect(requests.filter((request) => request.method === 'post')).toEqual([]);
  expect(screen.queryByText('You are the buyer.')).toBeNull();
});

it('keeps a reviewed signer current through balance-only and unrelated-account cache changes', async () => {
  const key = ['wallets', owner.ownerAccountUuid, 'trading'];
  client.setQueryData(key, { data: { results: state.wallets } });
  const signed = deferred<string>();
  const signer = vi.spyOn(localSigner, 'signEthereumTypedData').mockReturnValue(signed.promise);
  render(<TradingPage />, { wrapper });
  fireEvent.click(screen.getByTitle('Sign swap'));
  await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
  fireEvent.click(screen.getByText('Check token approval'));
  await waitFor(() => expect(screen.getByText('Continue to sign')).toBeTruthy());
  fireEvent.click(screen.getByText('Continue to sign'));
  fireEvent.change(screen.getByLabelText('Synthetic seed'), { target: { value: fixture.mnemonic } });
  fireEvent.click(screen.getByText('Sign trade'));
  await waitFor(() => expect(signer).toHaveBeenCalledOnce());
  act(() => {
    client.setQueryData(key, { data: { results: [{ ...state.wallets[0]!, nativeBalance: '5' }] } });
    client.setQueryData(['wallets', '20000000-0000-4000-8000-000000000099', 'trading'], { data: { results: [] } });
  });
  await act(async () => {
    signed.resolve(fixture.signatures[1]!);
    await signed.promise;
  });
  await waitFor(() => expect(screen.getByText('Your signature is recorded. Trade status: buyer_signed.')).toBeTruthy());
  expect(requests.filter((request) => request.method === 'post')).toHaveLength(1);
  expect(await swapSettlementStore.list(owner)).toEqual([]);
});

it.each([false, true])(
  'deduplicates multi-wallet list rows without losing either recorded side (reverse=%s)',
  async (reverse) => {
    const { useSwapOrdersMulti } =
      await vi.importActual<typeof import('./hooks/useAtomicSwaps')>('./hooks/useAtomicSwaps');
    const row = settlementListRow(captured);
    const wallets = [walletFor('seller'), walletFor('buyer')];
    if (reverse) wallets.reverse();
    const get = vi.spyOn(tradingApi, 'get').mockResolvedValue({ data: { results: [row] } });
    const view = renderHook(() => useSwapOrdersMulti(wallets.map((wallet) => wallet.address)), { wrapper });
    await waitFor(() => expect(view.result.current.data).toHaveLength(1));
    expect(get).toHaveBeenCalledTimes(2);
    const listed = view.result.current.data![0]!;
    expect(listed).not.toHaveProperty('settlementContext');
    expect(selectSwapSettlement(listed, owner, wallets).selection.orderUuid).toBe(captured.swapOrder.sellOrderUuid);
    expect(selectSwapSettlement({ ...listed, sellerHasSigned: true }, owner, wallets).selection.orderUuid).toBe(
      captured.swapOrder.buyOrderUuid,
    );
  },
);

it.each(['other chain', 'other account'] as const)(
  'uses the recorded buyer wallet when a same-address wallet comes first: %s',
  async (kind) => {
    const recorded = walletFor('buyer');
    state.wallets = [
      {
        ...recorded,
        uuid: '20000000-0000-4000-8000-000000000077',
        chain: kind === 'other chain' ? 'ethereum' : recorded.chain,
        userAccount: kind === 'other account' ? '20000000-0000-4000-8000-000000000099' : recorded.userAccount,
      },
      recorded,
    ];
    render(<TradingPage />, { wrapper });
    fireEvent.click(screen.getByTitle('Sign swap'));
    await waitFor(() => expect(screen.getByText('You are the buyer.')).toBeTruthy());
    expect(swapRequests()[0]!.params.wallet_uuid).toBe(recorded.uuid);
    expect(swapRequests()[0]!.params).not.toHaveProperty('settlement_digest');
    fireEvent.click(screen.getByText('Check token approval'));
    await waitFor(() => expect(swapRequests().length).toBeGreaterThan(1));
    for (const request of swapRequests().slice(1))
      expect(request.params.settlement_digest).toBe(captured.settlementDigest);
  },
);
