// @vitest-environment jsdom

import type { ReactNode } from 'react';
import type { AxiosInstance } from 'axios';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignupAccountType } from './SignupAccountType';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const api = { get: vi.fn(), patch: vi.fn() };
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  api.get.mockResolvedValue({ data: { uuid: 'account-1', role: 'investor' } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

async function companyChoice() {
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <SignupAccountType />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  const choice = (await screen.findByRole('button', { name: /Company Representative/ })) as HTMLButtonElement;
  await waitFor(() => expect(choice.disabled).toBe(false));
  return choice;
}

it('says why the account type was not saved and keeps the person on the step', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({
    response: { status: 409, data: { detail: 'Account type can no longer be changed.' } },
  });
  const choice = await companyChoice();

  fireEvent.click(choice);

  expect((await screen.findByRole('alert')).textContent).toBe('Account type can no longer be changed.');
  expect(navigate).not.toHaveBeenCalled();
  expect(choice.disabled).toBe(false);
});

it('moves on once the account type is saved', async () => {
  api.patch.mockResolvedValue({ data: { uuid: 'account-1', role: 'company' } });
  const choice = await companyChoice();

  fireEvent.click(choice);

  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/signup/identity-verification'));
  expect(screen.queryByRole('alert')).toBeNull();
});
