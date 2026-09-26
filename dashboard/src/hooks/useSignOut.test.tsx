// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_ENDPOINTS } from '@ledova/shared';
import { useSignOut } from './useSignOut';

const api = vi.hoisted(() => ({ post: vi.fn() }));
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
