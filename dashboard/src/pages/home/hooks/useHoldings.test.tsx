// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PAPER_THEME } from '@ledova/shared';
import type { HoldingWithWallet, Wallet } from '@ledova/shared';
import { useHoldings } from './useHoldings';

vi.mock('@services/apiClient', () => ({ default: {} }));

const holdingsApi = vi.hoisted(() => ({ getWalletHoldings: vi.fn() }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  getWalletHoldings: holdingsApi.getWalletHoldings,
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
});

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function held(symbol: string, marketValue: string) {
  return {
    uuid: `holding-${symbol}`,
    assetSymbol: symbol,
    assetName: `${symbol} Asset`,
    quantity: '1',
    marketValue,
    valueSource: 'market',
    chain: 'base',
    asset: { uuid: `asset-${symbol}`, symbol, name: `${symbol} Asset` },
  } as unknown as HoldingWithWallet;
}

it('draws the Home allocation in the paper chart palette', async () => {
  holdingsApi.getWalletHoldings.mockResolvedValue({ data: [held('AAA', '30'), held('BBB', '20'), held('CCC', '10')] });
  const wallets = [{ uuid: 'wallet-1', name: 'Main', address: '0x0', chain: 'base' }] as Wallet[];

  const { result } = renderHook(() => useHoldings(wallets), { wrapper });

  await waitFor(() => expect(result.current.assetAllocation).toHaveLength(3));
  expect(result.current.assetAllocation.map((item) => item.color)).toEqual(PAPER_THEME.chart.slice(0, 3));
});
