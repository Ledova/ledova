// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';
import OfferingPage from '.';
import { companyPreferences, companyRecord, renderCompanyPage } from '../testSupport';

const empty = { results: [], count: 0, next: null, previous: null };
const company = companyRecord({ status: 'active', statusDisplay: 'Active', canIssueTokens: true });
const token = {
  uuid: 'token-one',
  companyUuid: company.uuid,
  name: 'Ordinary shares',
  symbol: 'ORD',
  status: 'deployed',
};
const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient;
let interceptor: number | undefined;
let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>;

function response(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { config, status: 200, statusText: 'OK', data, headers: {} };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.method === 'post') return response(config, { uuid: 'new-offering', tokenUuid: token.uuid });
    if (config.url === '/api/v1/companies/') return response(config, { ...empty, results: [company] });
    if (config.url === `/api/v1/companies/${company.uuid}/`) return response(config, company);
    if (config.url === '/api/v1/tokens/') return response(config, { ...empty, results: [token] });
    if (config.url === '/api/operator/')
      return response(config, { name: 'Example Operator', supportedSettlementAssets: [] });
    if (config.url === '/api/v1/offerings/') return response(config, empty);
    throw new Error(`Unexpected request: ${config.url}`);
  });
  apiClient.defaults.adapter = adapter;
});

afterEach(() => {
  cleanup();
  client.clear();
  if (interceptor !== undefined) apiClient.interceptors.request.eject(interceptor);
  interceptor = undefined;
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

async function createDraft() {
  renderCompanyPage(client, <OfferingPage />, 'Offerings');
  await waitFor(() => expect(screen.getByRole('button', { name: 'New offering' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'New offering' }));
  const dialog = await screen.findByRole('dialog');
  for (const [label, value] of [
    ['Price per share (AUD)', '1.50'],
    ['Minimum shares', '10'],
    ['Target shares', '100'],
    ['Cap shares', '200'],
    ['Opens at', '2027-03-01T09:00'],
    ['Summary', 'Synthetic offering'],
  ])
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft offering' }));
}

it('dispatches a current owner offering through the actual guarded Axios transport', async () => {
  await createDraft();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const posts = adapter.mock.calls
    .map(([config]) => config as InternalAxiosRequestConfig)
    .filter((config) => config.method === 'post');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ url: '/api/v1/offerings/', ledovaSubmissionGuard: expect.any(Function) });
  expect(JSON.parse(posts[0]!.data)).toMatchObject({ token: token.uuid, summary: 'Synthetic offering' });
});

it('refuses a held offering before actual Axios dispatch when the acting account changes', async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  interceptor = apiClient.interceptors.request.use(async (config) => {
    if (config.method === 'post') {
      entered = true;
      await hold;
    }
    return config;
  });
  const posts = vi.spyOn(apiClient, 'post');
  await createDraft();
  await waitFor(() => expect(entered).toBe(true));
  const preferences = companyPreferences();
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { ...preferences, userAccount: { ...preferences.userAccount!, uuid: 'account-two' } },
    }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const sent = posts.mock.results[0]!.value as Promise<unknown>;
  await act(async () => {
    release();
    await sent.catch(() => undefined);
  });
  expect(
    adapter.mock.calls
      .map(([config]) => config as InternalAxiosRequestConfig)
      .filter((config) => config.method === 'post'),
  ).toEqual([]);
  await expect(sent).rejects.toMatchObject({ isUserFriendly: true });
});
