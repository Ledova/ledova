import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { AUTH_ENDPOINTS, COMPANY_TOKEN_ENDPOINTS, pauseCompanyToken } from '@ledova/shared';
import { apiClient } from './apiClient';
import { clearTokens, storeTokens } from './tokenStorage';
import { assertSessionEpoch, getSessionEpoch, invalidateSessionScope } from './sessionScope';
import { pauseSubmissionStore } from './pauseSubmissions';
import { owner, pauseResponse, resetPauseStorage, tokenUuid } from '../testSupport/pauseRequests';
import { deferred, response } from '../../../packages/shared/tests/fixtures/order-submissions';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const tokens = new Map<string, string>();
const initialAdapter = apiClient.defaults.adapter;
const record = { ...owner, tokenUuid, paused: true, submissionId: '44444444-4444-4444-8444-444444444444' };
beforeEach(async () => {
  resetPauseStorage();
  tokens.clear();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => tokens.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    tokens.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    tokens.delete(key);
  });
  await clearTokens();
  await storeTokens({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  apiClient.defaults.baseURL = process.env.EXPO_PUBLIC_API_URL;
});
afterEach(() => {
  apiClient.defaults.adapter = initialAdapter;
});

it.each([false, true])(
  'retries the same pause submission through bearer rotation only in its original session (retired=%s)',
  async (retired) => {
    await pauseSubmissionStore.retain(record);
    const epoch = getSessionEpoch();
    const started = deferred<void>();
    const refresh = deferred<void>();
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === AUTH_ENDPOINTS.TOKEN_REFRESH) {
        started.resolve();
        await refresh.promise;
        return response(config, { access: 'rotated-access', refresh: 'rotated-refresh' });
      }
      if (sent.filter((request) => request.url === config.url).length === 1)
        throw new AxiosError('Expired', undefined, config, undefined, response(config, {}, 401));
      return response(config, pauseResponse(record).data);
    };
    const posting = pauseCompanyToken(
      apiClient,
      tokenUuid,
      { submissionId: record.submissionId },
      {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: () => assertSessionEpoch(epoch),
      },
    ).then(
      () => null,
      (error: Error) => error,
    );
    await started.promise;
    if (retired) invalidateSessionScope();
    refresh.resolve();
    const failure = await posting;
    const pauses = sent.filter((request) => request.url === COMPANY_TOKEN_ENDPOINTS.PAUSE(tokenUuid));
    expect(pauses).toHaveLength(retired ? 1 : 2);
    for (const request of pauses) {
      expect(JSON.parse(request.data).submissionId).toBe(record.submissionId);
      expect(request.ledovaSessionEpoch).toBe(epoch);
      expect(typeof request.ledovaSubmissionGuard).toBe('function');
    }
    expect(await pauseSubmissionStore.list(owner, tokenUuid)).toEqual([record]);
    if (retired) expect(failure?.message).toContain('session changed');
    else {
      expect(failure).toBeNull();
      expect(pauses[1].headers.Authorization).toBe('Bearer rotated-access');
    }
  },
);
