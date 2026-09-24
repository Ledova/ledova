// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@hooks/useCurrency', () => ({
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value}` }),
}));

import { BuyCryptoModal } from './BuyCryptoModal';

const wallet = (uuid: string, name: string) => ({
  uuid,
  name,
  address: `0x${'4'.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'VERIFIED',
  nativeBalance: '1',
  marketValue: '1',
});
let client: QueryClient;

function Provider({
  initialAsset,
  onNavigateToWidget,
  onClose,
}: {
  initialAsset?: string;
  onNavigateToWidget: (url: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <BuyCryptoModal
      isOpen={open}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      onNavigateToWidget={(url) => {
        setOpen(false);
        onNavigateToWidget(url);
      }}
      userAccountUuid="synthetic-account"
      initialAsset={initialAsset}
    />
  );
}

function show(props: { initialAsset?: string; onNavigateToWidget?: (url: string) => void; onClose?: () => void }) {
  return render(
    <QueryClientProvider client={client}>
      <Provider
        initialAsset={props.initialAsset}
        onNavigateToWidget={props.onNavigateToWidget ?? (() => {})}
        onClose={props.onClose ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

function walletsResponse(results: ReturnType<typeof wallet>[]) {
  return { data: { results, count: results.length, next: null, previous: null } };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.post.mockResolvedValue({ data: { url: 'https://onramp.example.test/widget' } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

it('opens on the initial asset and goes straight to the widget for its only verified wallet', async () => {
  api.get.mockResolvedValue(walletsResponse([wallet('wallet-1', 'Only wallet')]));
  const navigate = vi.fn();
  show({ initialAsset: 'ETH', onNavigateToWidget: navigate });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://onramp.example.test/widget'));
  expect(api.get.mock.calls[0][1]).toEqual({
    params: { chain: 'ethereum', verification_status: 'VERIFIED', ordering: 'signing_preference' },
  });
  expect(api.post).toHaveBeenCalledOnce();
  expect(api.post.mock.calls[0][1]).toMatchObject({ wallet_uuid: 'wallet-1' });
});

it('asks which wallet receives the chosen asset when several match', async () => {
  api.get.mockResolvedValue(walletsResponse([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]));
  const navigate = vi.fn();
  show({ onNavigateToWidget: navigate });
  fireEvent.click(screen.getByText('Ethereum'));
  fireEvent.click(await screen.findByText('Second wallet'));
  await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  expect(api.post.mock.calls[0][1]).toMatchObject({ wallet_uuid: 'wallet-2' });
});

it('explains a missing wallet and goes back to the asset list', async () => {
  api.get.mockResolvedValue(walletsResponse([]));
  show({});
  fireEvent.click(screen.getByText('Bitcoin'));
  expect(await screen.findByText('No verified wallets for Bitcoin. Create one in Wallets.')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('Select an asset to purchase')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});

it('closes from the wallet step when it was opened on an initial asset', async () => {
  api.get.mockResolvedValue(walletsResponse([]));
  const closed = vi.fn();
  show({ initialAsset: 'BTC', onClose: closed });
  expect(await screen.findByText('No verified wallets for Bitcoin. Create one in Wallets.')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(closed).toHaveBeenCalledOnce();
});
