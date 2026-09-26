// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { ApiClientProvider, AUTH_ENDPOINTS } from '@ledova/shared';
import { SignOutButton } from '@components/SignOutButton';
import { AUTH_QUERY_KEY, useAuth } from './useAuth';
import { useSignOut } from './useSignOut';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('ends the session, forgets everything the tab held, and goes to sign in', async () => {
  api.post.mockResolvedValue({ data: {} });
  const client = new QueryClient();
  client.setQueryData(['userAccount'], { data: { role: 'company' } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useSignOut(), { wrapper });

  await act(async () => {
    result.current.signOut();
  });

  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/signin'));
  expect(api.post).toHaveBeenCalledWith(AUTH_ENDPOINTS.SIGNOUT);
  expect(client.getQueryData(['userAccount'])).toBeUndefined();
});

it('tells the frame the session ended, so the sign-out button the frame shows goes away', async () => {
  api.post.mockResolvedValue({ data: {} });
  api.get.mockResolvedValue({ data: { valid: false } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  function Frame() {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? <SignOutButton /> : <p>Signed out</p>;
  }
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemoryRouter>
          <Frame />
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  expect(await screen.findByText('Signed out')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});
