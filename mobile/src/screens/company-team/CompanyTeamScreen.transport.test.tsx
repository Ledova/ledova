import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { clearTokens, storeTokens } from '../../services/tokenStorage';
import { CompanyTeamScreen } from './CompanyTeamScreen';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const INVITATIONS = '/api/v1/company-authority/invitations/';
const tokens = new Map<string, string>();
const initialAdapter = apiClient.defaults.adapter;
const initialBase = apiClient.defaults.baseURL;
const initialEnvironment = process.env.EXPO_PUBLIC_API_URL;
const appointment: OwnCompanyAppointment = {
  uuid: 'appointment',
  company: 'company',
  companyName: 'Synthetic Company',
  source: 'initial',
  capabilities: ['admin'],
  delegatableCapabilities: ['prepare'],
  createdAt: '2026-10-04T00:00:00Z',
  expiresAt: null,
  revokedAt: null,
  status: 'active',
  isEffective: true,
  declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
  declarationText: COMPANY_AUTHORITY_DECLARATION,
};
let client: QueryClient;
let sent: InternalAxiosRequestConfig[];
let post: jest.SpiedFunction<typeof apiClient.post>;

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200) {
  return { config, data, status, statusText: 'OK', headers: {} };
}

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
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile', userAccount: { uuid: 'account', role: 'investor' } },
  });
  sent = [];
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    if (config.method === 'get') {
      if (config.url === `${APPOINTMENTS}team/`) return response(config, []);
      return response(config, { results: config.url === APPOINTMENTS ? [appointment] : [], next: null, count: 1 });
    }
    if (config.url === `${INVITATIONS}accept/`) return response(config, { ...appointment, source: 'invitation' });
    if (config.url?.endsWith('/revoke/'))
      return response(config, {
        ...appointment,
        status: 'revoked',
        isEffective: false,
        revokedAt: '2026-10-04T01:00:00Z',
      });
    const input = JSON.parse(config.data);
    return response(
      config,
      {
        ...input,
        uuid: 'invitation',
        companyName: appointment.companyName,
        delegatableCapabilities: input.delegatableCapabilities ?? [],
        appointmentExpiresAt: null,
        acceptanceDeadline: '2026-10-11T00:00:00Z',
        createdAt: appointment.createdAt,
        acceptedAt: null,
        code: 'S'.repeat(43),
      },
      201,
    );
  };
  post = jest.spyOn(apiClient, 'post');
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  await cleanup();
  client.clear();
  apiClient.defaults.adapter = initialAdapter;
  apiClient.defaults.baseURL = initialBase;
  if (initialEnvironment === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = initialEnvironment;
});

async function screen() {
  const view = await render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyTeamScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await view.findByRole('button', { name: 'Your appointment appointment' });
  return view;
}

it.each(['issue', 'accept', 'revoke'] as const)(
  'prevents the actual %s POST after the account changes during bearer retrieval',
  async (action) => {
    const view = await screen();
    if (action === 'issue') {
      await fireEvent.press(view.getByRole('radio', { name: 'Select company Synthetic Company' }));
      await fireEvent.press(view.getByRole('radio', { name: 'Select source appointment appointment' }));
      await fireEvent.press(view.getByRole('checkbox', { name: 'Permissions to exercise: Prepare register changes' }));
      await waitFor(() => expect(sent.some((request) => request.url === `${APPOINTMENTS}team/`)).toBe(true));
    } else if (action === 'accept') {
      await fireEvent.changeText(view.getByLabelText('Invitation code'), 'S'.repeat(43));
      await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
    } else {
      await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment' }));
      await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment' }));
    }
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (first && key === 'session.tokens.v2') {
        first = false;
        entered();
        await held;
      }
      return tokens.get(key) ?? null;
    });
    try {
      if (action === 'revoke') await act(() => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1].onPress?.());
      else
        await fireEvent.press(
          view.getByRole('button', { name: action === 'issue' ? 'Create invitation' : 'Accept invitation' }),
        );
      await started;
      const posting = post.mock.results[0].value as Promise<AxiosResponse>;
      const refused = expect(posting).rejects.toThrow('Your account changed');
      await act(() =>
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
        }),
      );
      await act(async () => {
        release();
        await refused;
      });
      expect(sent.filter((request) => request.method === 'post')).toHaveLength(0);
      expect(view.queryByLabelText('One-time invitation code')).toBeNull();
    } finally {
      release();
    }
  },
);

it('sends a confirmed acceptance through the actual bearer interceptor in its original account', async () => {
  const view = await screen();
  await fireEvent.changeText(view.getByLabelText('Invitation code'), 'S'.repeat(43));
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  await view.findByText(/Appointment recorded for Synthetic Company/);
  const writes = sent.filter((request) => request.method === 'post');
  expect(writes).toHaveLength(1);
  expect(writes[0].headers.Authorization).toBe('Bearer synthetic-access');
  expect(JSON.parse(writes[0].data)).toEqual({
    code: 'S'.repeat(43),
    declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
    acceptDeclaration: true,
  });
});
