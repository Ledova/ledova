// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { IdentityVerificationModal } from './IdentityVerificationModal';

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@sumsub/websdk', () => ({ default: { init: vi.fn() } }));

let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(apiClient.get).mockResolvedValue({ data: { isVerified: false, status: 'init' } });
  vi.mocked(apiClient.post).mockResolvedValue({ data: { formUrl: 'https://verification.example.test/form' } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('states a finished check without a box and closes from its action row', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { isVerified: true, status: 'completed' } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <IdentityVerificationModal isOpen onClose={onClose} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Identity Verification' });
  expect(await screen.findByRole('heading', { level: 3, name: 'Already Verified' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start Verification' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('refreshes the profile and closes shortly after the form is submitted', async () => {
  const onClose = vi.fn();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <IdentityVerificationModal isOpen onClose={onClose} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Start Verification' }));
  await screen.findByTitle('Identity Verification');
  invalidate.mockClear();
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { event: 'FORM_COMPLETED' } }));
  });
  expect(screen.getByText('Verification Submitted')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userProfiles'] });
  expect(onClose).toHaveBeenCalledTimes(1);
});
