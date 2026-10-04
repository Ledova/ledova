// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';
import CompanyPage from '.';
import ListingPage from './listing';
import {
  companyPreferences,
  companyRecord,
  documentRecord,
  prepareCompanyClient,
  renderCompanyPage,
} from './testSupport';

const originalAdapter = apiClient.defaults.adapter;
let client: QueryClient;
let company: ReturnType<typeof companyRecord>;
let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>;
let interceptor: number | undefined;

function response(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { config, status: 200, statusText: 'OK', data, headers: {} };
}

beforeEach(() => {
  company = companyRecord({ isOwner: false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  prepareCompanyClient(client, 'investor');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/api/v1/companies/' && config.method === 'get')
      return response(config, { results: [company], count: 1, next: null, previous: null });
    if (config.url === '/api/v1/companies/company-one/' && config.method === 'get') return response(config, company);
    if (config.url === '/api/v1/companies/company-one/' && config.method === 'patch') {
      company = { ...company, ...JSON.parse(config.data) };
      return response(config, company);
    }
    if (config.url === '/api/v1/companies/company-one/documents/' && config.method === 'post')
      return response(config, { ...documentRecord('cert_inc'), name: 'current.pdf' });
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
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

async function edit() {
  renderCompanyPage(client, <CompanyPage />, 'Company');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit company' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '12345' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
}

it('dispatches an investor administrator edit through the actual guarded Axios transport', async () => {
  await edit();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const patches = adapter.mock.calls.map(([config]) => config).filter((config) => config.method === 'patch');
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({
    url: '/api/v1/companies/company-one/',
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(JSON.parse(patches[0]!.data)).toEqual({ phone: '12345' });
  expect(screen.queryByRole('button', { name: 'Create share class' })).toBeNull();
});

it.each(['edit', 'upload'])(
  'retires a held %s before actual dispatch when the acting account changes',
  async (action) => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const method = action === 'edit' ? 'patch' : 'post';
    interceptor = apiClient.interceptors.request.use(async (config) => {
      if (config.method === method) {
        entered = true;
        await hold;
      }
      return config;
    });
    const writes = vi.spyOn(apiClient, method);
    if (action === 'edit') await edit();
    else {
      renderCompanyPage(client, <CompanyPage />, 'Company');
      fireEvent.click(await screen.findByRole('button', { name: 'Upload Certificate of Incorporation' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Document file'), {
        target: { files: [new File(['synthetic'], 'current.pdf', { type: 'application/pdf' })] },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    }
    await waitFor(() => expect(entered).toBe(true));
    const preferences = companyPreferences('investor');
    act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { ...preferences, userAccount: { ...preferences.userAccount!, uuid: 'account-two' } },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = writes.mock.results[0]!.value as Promise<unknown>;
    await act(async () => {
      release();
      await sent.catch(() => undefined);
    });
    expect(adapter.mock.calls.map(([config]) => config).filter((config) => config.method === method)).toEqual([]);
    await expect(sent).rejects.toMatchObject({ isUserFriendly: true });
  },
);

it('dispatches an appointed investor activation through actual Axios with the exact declaration and replay key', async () => {
  const key = '70000000-0000-4000-8000-000000000001';
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(key);
  company = {
    ...company,
    activation: {
      appointment: '80000000-0000-4000-8000-000000000001',
      lifecycleRevision: 2,
      declarationVersion: '2026-10-04',
      declarationText: 'Synthetic current declaration',
      latestAttempt: null,
    },
  };
  const original = adapter.getMockImplementation()!;
  adapter.mockImplementation(async (config) => {
    if (config.url?.endsWith('/activate/') && config.method === 'post') {
      const request = JSON.parse(config.data);
      expect(request).toEqual({
        idempotencyKey: key,
        appointment: company.activation!.appointment,
        lifecycleRevision: 2,
        declarationVersion: '2026-10-04',
        acceptDeclaration: true,
      });
      const attempt = {
        uuid: '90000000-0000-4000-8000-000000000001',
        ...request,
        status: 'failed' as const,
        reason: 'unconfigured',
        startedAt: '2026-10-05T01:00:00Z',
        completedAt: '2026-10-05T01:00:01Z',
        appliedAt: null,
        declarationText: company.activation!.declarationText,
      };
      company = { ...company, activation: { ...company.activation!, latestAttempt: attempt } };
      return response(config, { company, attempt });
    }
    return original(config);
  });
  renderCompanyPage(client, <ListingPage />, 'Activation');
  fireEvent.click(await screen.findByRole('button', { name: 'Review activation' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm activation' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(adapter.mock.calls.map(([config]) => config).filter((config) => config.method === 'post')).toHaveLength(1);
  expect(await screen.findByText(/No activation was applied. The ABR lookup is not configured/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['appointment', 'list capability', 'account'] as const)(
  'refuses actual activation dispatch after held transport %s loss',
  async (kind) => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('70000000-0000-4000-8000-000000000001');
    company = {
      ...company,
      activation: {
        appointment: '80000000-0000-4000-8000-000000000001',
        lifecycleRevision: 2,
        declarationVersion: '2026-10-04',
        declarationText: 'Synthetic current declaration',
        latestAttempt: null,
      },
    };
    let entered = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    interceptor = apiClient.interceptors.request.use(async (config) => {
      if (config.url?.endsWith('/activate/')) {
        entered = true;
        await held;
      }
      return config;
    });
    const writes = vi.spyOn(apiClient, 'post');
    renderCompanyPage(client, <ListingPage />, 'Activation');
    fireEvent.click(await screen.findByRole('button', { name: 'Review activation' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm activation' }));
    await waitFor(() => expect(entered).toBe(true));
    act(() => {
      if (kind === 'account')
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { ...companyPreferences('investor'), userProfile: 'profile-two' },
        });
      else if (kind === 'list capability')
        client.setQueryData(client.getQueryCache().findAll({ queryKey: ['companies'] })[0]!.queryKey, [
          { ...company, administrativeAccess: { capabilities: [], draftSetup: false } },
        ]);
      else
        client.setQueryData(client.getQueryCache().findAll({ queryKey: ['company', company.uuid] })[0]!.queryKey, {
          ...company,
          activation: { ...company.activation!, appointment: '80000000-0000-4000-8000-000000000002' },
        });
    });
    const sent = writes.mock.results[0]!.value as Promise<unknown>;
    await act(async () => {
      release();
      await sent.catch(() => undefined);
    });
    expect(adapter.mock.calls.map(([config]) => config).filter((config) => config.method === 'post')).toEqual([]);
    await expect(sent).rejects.toMatchObject({ isUserFriendly: true });
  },
);
