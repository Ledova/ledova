// @vitest-environment jsdom

import { useLayoutEffect, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { USER_ACCOUNT_ENDPOINTS, USER_PROFILE_ENDPOINTS, type Audience } from '@ledova/shared';

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };
const pending = vi.hoisted(() => new Map<string, Deferred>());
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: false }) }));
vi.mock('@hooks/useSelectedPortfolio', () => ({ useSelectedPortfolio: () => ({ userAccount: { uuid: 'owner' } }) }));
vi.mock('@pages/wallets/components/BuyCryptoModal', () => ({ BuyCryptoModal: () => null }));
vi.mock('@pages/wallets/components/BuyCryptoWidgetModal', () => ({ BuyCryptoWidgetModal: () => null }));
vi.mock('@hooks/useSendTransfer', () => ({ SendTransferProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('@components/Sidebar', () => ({ Sidebar: () => <nav aria-label="Sidebar" /> }));
vi.mock('@components/DesktopHeader', () => ({ DesktopHeader: () => null }));
vi.mock('@components/MobileHeader', () => ({ MobileHeader: () => null }));
vi.mock('@components/Footer', () => ({ default: () => null }));

import Layout from '@components/Layout';
import { ProtectedRoute } from './ProtectedRoute';

const renders: string[] = [];

function Page({ name }: { name: string }) {
  useLayoutEffect(() => {
    renders.push(`${name} ${document.querySelector('nav[aria-label="Sidebar"]') ? 'framed' : 'outside the frame'}`);
  });
  return <p>{name}</p>;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function microtasks() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 400 && !condition(); attempt++) await wait(5);
}

function scheduleRendersAsTheBrowserDoes() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
}

async function answerTheRoleThenTheProfileBeforeTheRoleReachesItsSubscribers() {
  pending.get(USER_ACCOUNT_ENDPOINTS.BASE)!.resolve({ data: { uuid: 'owner', role: 'investor' } });
  await microtasks();
  pending.get(USER_PROFILE_ENDPOINTS.BASE)!.resolve({
    data: { results: [{ uuid: 'profile', isSignupCompleted: true }], count: 1, next: null, previous: null },
  });
  await microtasks();
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  scheduleRendersAsTheBrowserDoes();
  renders.length = 0;
  pending.clear();
  api.get.mockImplementation((url: string) => {
    const answer = deferred();
    pending.set(url, answer);
    return answer.promise;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  root.unmount();
  container.remove();
  await wait(5);
});

it.each(['investing', 'everyone'] as const)(
  'renders a directly loaded %s page only inside the signed-in frame, even when the role answers first',
  async (audience: Audience) => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/page']}>
          <Layout>
            <Routes>
              <Route
                path="/page"
                element={
                  <ProtectedRoute audience={audience}>
                    <Page name={audience} />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Layout>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await until(() => pending.size === 2);
    expect([...pending.keys()].sort()).toEqual([USER_ACCOUNT_ENDPOINTS.BASE, USER_PROFILE_ENDPOINTS.BASE].sort());

    await answerTheRoleThenTheProfileBeforeTheRoleReachesItsSubscribers();
    await until(() => renders.includes(`${audience} framed`));

    expect(container.textContent).toContain(audience);
    expect(renders).toContain(`${audience} framed`);
    expect(renders).not.toContain(`${audience} outside the frame`);
  },
);
