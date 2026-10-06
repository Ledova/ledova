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
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: false }),
}));
vi.mock('@hooks/useRole', () => ({
  useRole: () => ({ role: 'both', isKnown: true, isUnavailable: false, isLoading: false, retry: vi.fn() }),
}));

import { PAGES } from './pages';
import { signedInRoutes } from './signedInRoutes';

const KEYS = Object.keys(DESTINATIONS) as DestinationKey[];
const LEDES: Partial<Record<DestinationKey, string>> = {
  wallets: 'Verify a wallet to send from it or buy crypto into it.',
  transactions: 'Select an entry for its status and details.',
  companyRegister:
    "The stored register records your company's members and their shares; wallet balances do not replace it.",
  companyRegisterImport:
    "Import a share class's existing register from the company's own records. The evidence and figures are provided " +
    'by the company.',
  companyRegisterCorrection:
    "Prepare a correction that reverses one entry of a share class's register exactly. The authority document is " +
    'provided by the company.',
  companyRegisterLinks:
    "Link the wallets that completed issues and transfers wait for to the company's members. The authority document " +
    'is provided by the company.',
  companyRegisterOpening:
    "Prepare an opening that records a share class's holdings on chain as its register's first entry. The authority " +
    'document is provided by the company.',
  companyRegisterParticulars:
    "Prepare a change to a member's name and residential address on the register. The supporting document is " +
    'provided by the company.',
  companyPublications: "Staff prepare and publish these records on your company's written instruction.",
  eligibilityRequests:
    'Each company decides eligibility for its own offerings and share classes. New actions recheck the current decision, evidence and exact scope.',
  companyEligibility:
    'Each company decides eligibility for its own offerings and share classes. New actions recheck the current decision, evidence and exact scope.',
};
const EMPTY = { results: [], count: 0, next: null, previous: null };
const UUID = '7f1c2a9e';

afterEach(cleanup);

it.each(KEYS)('titles the real %s page, with its lede where it has one, once reads come back empty', async (key) => {
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

  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => {
    expect(client.isFetching()).toBe(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS[key].title);
  });
  expect(screen.getByRole('heading', { level: 1, description: LEDES[key] ?? '' })).toBeTruthy();
  client.clear();
});
