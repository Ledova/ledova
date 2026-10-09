import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import {
  AUTH_ENDPOINTS,
  COMPANY_TOKEN_ENDPOINTS,
  prepareRegisterPaidIssue,
  type RegisterPaidIssuePreparation,
} from '@ledova/shared';
import { apiClient } from './apiClient';
import { clearTokens, storeTokens } from './tokenStorage';
import { assertSessionEpoch, getSessionEpoch, invalidateSessionScope } from './sessionScope';
import { deferred, response } from '../../../packages/shared/tests/fixtures/order-submissions';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const tokens = new Map<string, string>();
const initialAdapter = apiClient.defaults.adapter;
const body: RegisterPaidIssuePreparation = {
  operationId: '00000000-0000-4000-8000-000000000001',
  appointment: '00000000-0000-4000-8000-000000000002',
  subscription: '00000000-0000-4000-8000-000000000003',
  approvingDirector: 'Synthetic Director',
  reason: 'Approve recorded paid allotment',
  authorityReference: 'BOARD-1',
  authorityEvidence: '00000000-0000-4000-8000-000000000004',
};
beforeEach(async () => {
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
it.each([
  ['healthy fresh', false, false, false],
  ['lapsed fresh source', true, false, false],
  ['retained original receipt', true, true, false],
  ['retired original epoch', false, true, true],
] as const)(
  'retains the full exact company paid issue body through actual bearer transport under %s',
  async (_name, loseSource, recovering, retireEpoch) => {
    const epoch = getSessionEpoch(),
      started = deferred<void>(),
      refresh = deferred<void>();
    const sent: InternalAxiosRequestConfig[] = [];
    let sourceCurrent = true;
    const guard = () => {
      assertSessionEpoch(epoch);
      if (!recovering && !sourceCurrent) throw new Error('The current company source lapsed.');
    };
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === AUTH_ENDPOINTS.TOKEN_REFRESH) {
        started.resolve();
        await refresh.promise;
        return response(config, { access: 'rotated-access', refresh: 'rotated-refresh' });
      }
      if (sent.filter((row) => row.url === config.url).length === 1)
        throw new AxiosError('Expired', undefined, config, undefined, response(config, {}, 401));
      return response(config, { uuid: body.operationId });
    };
    const posting = prepareRegisterPaidIssue(apiClient, body, {
      ledovaSessionEpoch: epoch,
      ledovaSubmissionGuard: guard,
    }).then(
      () => null,
      (error: Error) => error,
    );
    await started.promise;
    if (loseSource) sourceCurrent = false;
    if (retireEpoch) invalidateSessionScope();
    refresh.resolve();
    const failure = await posting;
    const posts = sent.filter((row) => row.url === COMPANY_TOKEN_ENDPOINTS.REGISTER_PAID_ISSUES);
    const refused = retireEpoch || (loseSource && !recovering);
    expect(posts).toHaveLength(refused ? 1 : 2);
    for (const config of posts) {
      expect(JSON.parse(config.data)).toEqual(body);
      expect(config.ledovaSessionEpoch).toBe(epoch);
      expect(config.ledovaSubmissionGuard).toBe(guard);
    }
    if (refused) expect(failure).toBeInstanceOf(Error);
    else {
      expect(failure).toBeNull();
      expect(posts[1].headers.Authorization).toBe('Bearer rotated-access');
    }
  },
);
