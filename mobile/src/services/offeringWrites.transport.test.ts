import { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import * as SecureStore from 'expo-secure-store';
import {
  AUTH_ENDPOINTS,
  createOffering,
  updateOffering,
  deleteOffering,
  submitOffering,
  withdrawOffering,
  updateCompany,
  type OfferingInput,
} from '@ledova/shared';
import { apiClient } from './apiClient';
import { clearTokens, getRefreshToken, storeTokens } from './tokenStorage';
import { getSessionEpoch } from './sessionScope';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const items = new Map<string, string>();
const input: OfferingInput = {
  token: 'class-one',
  pricePerShare: '2.50',
  minimumShares: 1,
  targetShares: 100,
  capShares: 1000,
  maximumShares: null,
  opensAt: '2026-10-01T10:00:00Z',
  closesAt: null,
  exemption: 's708_11_professional',
  summary: 'Example',
  useOfProceeds: 'Example',
  acceptsBankTransfer: true,
  settlementAssets: [],
};
const writes = [
  ['create', (epoch: number) => createOffering(apiClient, input, { ledovaSessionEpoch: epoch })],
  ['update', (epoch: number) => updateOffering(apiClient, 'offering-one', input, { ledovaSessionEpoch: epoch })],
  ['submit', (epoch: number) => submitOffering(apiClient, 'offering-one', { ledovaSessionEpoch: epoch })],
  [
    'withdraw',
    (epoch: number) => withdrawOffering(apiClient, 'offering-one', 'Example', { ledovaSessionEpoch: epoch }),
  ],
  ['delete', (epoch: number) => deleteOffering(apiClient, 'offering-one', { ledovaSessionEpoch: epoch })],
  [
    'directory',
    (epoch: number) =>
      updateCompany(apiClient, 'company-one', { isOpenToInvestors: true }, { ledovaSessionEpoch: epoch }),
  ],
] as const;
const originalAdapter = apiClient.defaults.adapter;

beforeEach(async () => {
  items.clear();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => items.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    items.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    items.delete(key);
  });
  await clearTokens();
  await storeTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  apiClient.defaults.baseURL = process.env.EXPO_PUBLIC_API_URL;
});
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function expired(config: Parameters<AxiosAdapter>[0]) {
  return new AxiosError('Expired', 'ERR_BAD_REQUEST', config, undefined, {
    data: {},
    status: 401,
    statusText: 'Unauthorized',
    headers: new AxiosHeaders(),
    config,
  });
}
function accepted(config: Parameters<AxiosAdapter>[0]) {
  return {
    data:
      config.url === AUTH_ENDPOINTS.TOKEN_REFRESH
        ? { access: 'rotated-access', refresh: 'rotated-refresh' }
        : { accepted: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

it.each(writes)('%s keeps its captured epoch through ordinary 401 rotation', async (_, write) => {
  const epoch = getSessionEpoch();
  const requests: Parameters<AxiosAdapter>[0][] = [];
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    if (requests.length === 1) throw expired(config);
    return accepted(config);
  };
  await expect(write(epoch)).resolves.toMatchObject({ data: { accepted: true } });
  expect(requests).toHaveLength(3);
  expect(requests[1].url).toBe(AUTH_ENDPOINTS.TOKEN_REFRESH);
  expect(requests[2].url).toBe(requests[0].url);
  expect(requests[2].data).toBe(requests[0].data);
  expect(requests[2].headers.Authorization).toBe('Bearer rotated-access');
  expect(requests.every((request) => request.ledovaSessionEpoch === epoch)).toBe(true);
});

it.each(writes)('%s cannot dispatch after account replacement during bearer lookup', async (_, write) => {
  const epoch = getSessionEpoch();
  const read = jest.mocked(SecureStore.getItemAsync).getMockImplementation()!;
  const entered = deferred<void>();
  const release = deferred<void>();
  let held = false;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
    if (key === 'session.tokens.v2' && !held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return read(key);
  });
  const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>(async (config) => accepted(config));
  apiClient.defaults.adapter = adapter;
  const refused = expect(write(epoch)).rejects.toThrow('session changed');
  await entered.promise;
  const signingIn = storeTokens({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  release.resolve();
  await Promise.all([signingIn, refused]);
  expect(adapter).not.toHaveBeenCalled();
  await expect(getRefreshToken()).resolves.toBe('new-refresh');
});

it.each(writes)('%s cannot refresh or replay after account retirement', async (_, write) => {
  const epoch = getSessionEpoch();
  const entered = deferred<Parameters<AxiosAdapter>[0]>();
  const response = deferred<AxiosResponse>();
  const requests: Parameters<AxiosAdapter>[0][] = [];
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    if (requests.length === 1) {
      entered.resolve(config);
      return response.promise;
    }
    return accepted(config);
  };
  const refused = expect(write(epoch)).rejects.toThrow('session changed');
  const config = await entered.promise;
  await clearTokens();
  await storeTokens({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  response.reject(expired(config));
  await refused;
  expect(requests).toHaveLength(1);
  await expect(getRefreshToken()).resolves.toBe('new-refresh');
});
