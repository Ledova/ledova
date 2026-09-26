// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiClientProvider,
  DESTINATIONS,
  FEATURE_FLAG_ENDPOINTS,
  USER_PROFILE_ENDPOINTS,
  type DestinationKey,
} from '@ledova/shared';
import type { AxiosInstance } from 'axios';

import { InSignedInFrame } from '@components/InSignedInFrame';
import { BuyCryptoProvider } from '@hooks/useBuyCrypto';
import { SendTransferProvider } from '@hooks/useSendTransfer';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => null }));
vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: false }) }));
vi.mock('@hooks/useRole', () => ({
  useRole: () => ({ role: 'both', isKnown: true, isUnavailable: false, isLoading: false, retry: vi.fn() }),
}));

import { PAGES } from './pages';
import { signedInRoutes } from './signedInRoutes';

const KEYS = Object.keys(DESTINATIONS) as DestinationKey[];
const EMPTY = { results: [], count: 0, next: null, previous: null };
const UUID = '7f1c2a9e';

afterEach(cleanup);

it.each(KEYS)('keeps the real %s page titled once everything it asked for has come back empty', async (key) => {
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith(FEATURE_FLAG_ENDPOINTS.BASE)) {
      return { data: { ...EMPTY, results: [{ name: 'trading_enabled', enabled: true }] } };
    }
    if (url === USER_PROFILE_ENDPOINTS.BASE) {
      return { data: { ...EMPTY, results: [{ uuid: 'profile', isSignupCompleted: true }] } };
    }
    if (url.includes(UUID)) {
      throw Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404, data: {} } });
    }
    return { data: EMPTY };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <InSignedInFrame.Provider value>
          <BuyCryptoProvider>
            <SendTransferProvider>
              <MemoryRouter initialEntries={[DESTINATIONS[key].path.replace(':uuid', UUID)]}>
                <Routes>{signedInRoutes(PAGES)}</Routes>
              </MemoryRouter>
            </SendTransferProvider>
          </BuyCryptoProvider>
        </InSignedInFrame.Provider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(client.isFetching()).toBe(0));

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS[key].title);
  client.clear();
});
