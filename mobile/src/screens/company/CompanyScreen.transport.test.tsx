import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  ApiClientProvider,
  AUTH_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  REQUIRED_DOCUMENTS,
  type CompanyDocument,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { clearTokens, storeTokens } from '../../services/tokenStorage';
import { invalidateSessionScope } from '../../services/sessionScope';
import { companyDetail, companyPreferences, companyQueryClient } from '../../testSupport/companyAdministration';
import { cache, files, pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { CompanyScreen } from '.';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const LIST = '/api/v1/companies/';
const DETAIL = `${LIST}company-a/`;
const originalAdapter = apiClient.defaults.adapter;
const originalBase = apiClient.defaults.baseURL;
const originalEnvironment = process.env.EXPO_PUBLIC_API_URL;
const tokens = new Map<string, string>();
let client: QueryClient;
let sent: InternalAxiosRequestConfig[];
let current = companyDetail({ isOwner: false });
let multiple = false;
let wrongUpload = false;
let refuseDelete = false;
let failDetail = false;
let detailControl: ((config: InternalAxiosRequestConfig) => Promise<ReturnType<typeof response>>) | null;
let patchControl: ((config: InternalAxiosRequestConfig) => Promise<ReturnType<typeof response>>) | null;
let fileControl: ((config: InternalAxiosRequestConfig) => Promise<ReturnType<typeof response>>) | null;
let refreshControl: ((config: InternalAxiosRequestConfig) => Promise<ReturnType<typeof response>>) | null;

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200, headers = {}) {
  return { config, data, status, statusText: 'OK', headers };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  resetFiles();
  tokens.clear();
  multiple = false;
  wrongUpload = false;
  refuseDelete = false;
  patchControl = null;
  fileControl = null;
  refreshControl = null;
  detailControl = null;
  failDetail = false;
  current = companyDetail({ isOwner: false });
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => tokens.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    tokens.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    tokens.delete(key);
  });
  await clearTokens();
  await storeTokens({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  apiClient.defaults.baseURL = process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  client = companyQueryClient('investor');
  sent = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset().mockResolvedValue(pickedFile());
  jest.mocked(Sharing.isAvailableAsync).mockReset().mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockReset().mockResolvedValue(undefined);
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    if (config.url === '/api/auth/verify/') return response(config, { valid: true });
    if (config.url === '/api/user-preferences/') return response(config, companyPreferences('investor'));
    if (config.url === AUTH_ENDPOINTS.TOKEN_REFRESH && refreshControl) return refreshControl(config);
    if (config.method === 'get') {
      if (config.url === '/api/v1/tokens/') return response(config, { results: [], next: null, count: 0 });
      if (config.url === LIST)
        return response(config, {
          results: [
            current,
            ...(multiple ? [companyDetail({ uuid: 'company-b', name: 'Second Company', isOwner: false })] : []),
          ],
          next: null,
          count: multiple ? 2 : 1,
        });
      if (config.url === DETAIL) {
        if (failDetail)
          throw new AxiosError(
            'Synthetic company read refusal',
            'ERR_BAD_RESPONSE',
            config,
            undefined,
            response(config, {}, 503),
          );
        if (detailControl) return detailControl(config);
        return response(config, { ...current });
      }
      if (config.url === `${LIST}company-b/`)
        return response(config, companyDetail({ uuid: 'company-b', name: 'Second Company', isOwner: false }));
      if (config.url?.endsWith('/file/') && fileControl) return fileControl(config);
    }
    if (config.method === 'patch') {
      if (patchControl) return patchControl(config);
      current = { ...current, ...JSON.parse(config.data) };
      return response(config, { ...current });
    }
    if (config.method === 'post' && config.url === `${DETAIL}documents/`) {
      const input = Object.fromEntries((config.data as FormData).entries());
      const document: CompanyDocument = {
        uuid: 'document-a',
        company: wrongUpload ? 'company-b' : current.uuid,
        name: String(input.name),
        documentType: input.document_type as CompanyDocument['documentType'],
        documentTypeDisplay: 'Synthetic evidence',
        isVerified: false,
        verifiedAt: null,
        createdAt: '2026-10-04T00:00:00Z',
        fileUrl: `${DETAIL}documents/document-a/file/`,
        fileSize: 4,
        mimeType: 'application/pdf',
      };
      if (!wrongUpload) current = { ...current, documents: [...current.documents, document] };
      return response(config, document, 201);
    }
    if (config.method === 'delete') {
      if (refuseDelete)
        throw new AxiosError(
          'Retained document',
          'ERR_BAD_REQUEST',
          config,
          undefined,
          response(config, { detail: 'This offered document must be retained.' }, 403),
        );
      current = { ...current, documents: [] };
      return response(config, null, 204);
    }
    throw new Error(`Unexpected synthetic request: ${config.method} ${config.url}`);
  };
});

afterEach(async () => {
  await cleanup();
  client.clear();
  apiClient.defaults.adapter = originalAdapter;
  apiClient.defaults.baseURL = originalBase;
  if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = originalEnvironment;
});

async function screen() {
  const view = await render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  if (multiple) await fireEvent.press(await view.findByRole('button', { name: 'Select company Synthetic Company' }));
  await view.findByRole('button', { name: 'Edit company' });
  return view;
}

async function edit() {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Edit company' }));
  await fireEvent.changeText(view.getByLabelText('Phone'), '02000');
  return view;
}

it('sends a current investor administrator edit through the real bearer transport and exact detail receipt', async () => {
  const view = await edit();
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.queryByLabelText('Phone')).toBeNull());
  const writes = sent.filter((config) => config.method === 'patch');
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toBe(DETAIL);
  expect(writes[0].headers.Authorization).toBe('Bearer synthetic-access');
  expect(JSON.parse(writes[0].data)).toEqual({ phone: '02000' });
  expect(sent.some((config) => config.url === '/api/v1/tokens/')).toBe(false);
});

it('keeps an explicit company choice after the selected company loses authority and one other remains', async () => {
  multiple = true;
  const view = await screen();
  current = { ...current, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(() => client.invalidateQueries({ queryKey: ['companies'] }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Edit company' })).toBeNull());
  expect(sent.filter((config) => config.url === `${LIST}company-b/`)).toHaveLength(0);
  const choice = await view.findByRole('button', { name: 'Select company Second Company', selected: false });
  await fireEvent.press(choice);
  await view.findByRole('button', { name: 'Edit company' });
  expect(sent.filter((config) => config.url === `${LIST}company-b/`)).toHaveLength(1);
});

it.each(['account', 'epoch', 'selection', 'closed-dialog'] as const)(
  'blocks an actual PATCH after %s changes while bearer retrieval is held',
  async (change) => {
    multiple = change === 'selection';
    const view = await edit();
    const cancel = view.getByRole('button', { name: 'Cancel' });
    let fiber: typeof cancel.unstable_fiber | null = cancel.unstable_fiber;
    while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
    const close = fiber?.memoizedProps.onPress;
    expect(typeof close).toBe('function');
    const entered = deferred<void>();
    const held = deferred<void>();
    let first = true;
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (first && key === 'session.tokens.v2') {
        first = false;
        entered.resolve();
        await held.promise;
      }
      return tokens.get(key) ?? null;
    });
    const patch = jest.spyOn(apiClient, 'patch');
    try {
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
      await entered.promise;
      const refused = expect(patch.mock.results[0].value).rejects.toThrow();
      if (change === 'account')
        await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor', 'b') }));
      if (change === 'epoch') await act(() => invalidateSessionScope());
      if (change === 'selection')
        await fireEvent.press(view.getByRole('button', { name: 'Select company Second Company' }));
      if (change === 'closed-dialog') await act(() => close());
      await act(async () => {
        held.resolve();
        await refused;
      });
      expect(sent.filter((config) => config.method === 'patch')).toHaveLength(0);
    } finally {
      held.resolve();
      patch.mockRestore();
    }
  },
);

it('rejects a late old-account edit receipt before invalidating any company cache', async () => {
  const entered = deferred<InternalAxiosRequestConfig>();
  const held = deferred<ReturnType<typeof response>>();
  patchControl = async (config) => {
    entered.resolve(config);
    return held.promise;
  };
  const view = await edit();
  const invalidated = jest.spyOn(client, 'invalidateQueries');
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  const request = await entered.promise;
  await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor', 'b') }));
  await act(async () => {
    held.resolve(response(request, { ...current, phone: '02000' }));
    await held.promise;
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(invalidated).not.toHaveBeenCalled();
  expect(
    client
      .getQueryCache()
      .findAll({ queryKey: ['company'] })
      .every((query) => (query.state.data as typeof current | undefined)?.phone !== '02000'),
  ).toBe(true);
});

it('does not replay a refused PATCH into a changed account after actual bearer refresh', async () => {
  const entered = deferred<InternalAxiosRequestConfig>();
  const held = deferred<ReturnType<typeof response>>();
  refreshControl = async (config) => {
    entered.resolve(config);
    return held.promise;
  };
  patchControl = async (config) => {
    throw new AxiosError('Expired bearer', 'ERR_BAD_REQUEST', config, undefined, response(config, {}, 401));
  };
  const view = await edit();
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  const refresh = await entered.promise;
  await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor', 'b') }));
  await act(async () => {
    held.resolve(response(refresh, { access: 'synthetic-new-access', refresh: 'synthetic-new-refresh' }));
    await held.promise;
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(sent.filter((config) => config.method === 'patch')).toHaveLength(1);
});

async function chooseDocument() {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: `Upload ${REQUIRED_DOCUMENTS[0].label}` }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose document' }));
  await view.findByText('1.pdf');
  return view;
}

it('uploads, reads and removes company documents through guarded transport while retiring private copies', async () => {
  const view = await chooseDocument();
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await view.findByRole('button', { name: 'View 1.pdf' });
  expect(Array.from(files.keys()).filter((uri) => uri.includes('ledova-upload-copies'))).toEqual([]);
  fileControl = async (config) =>
    response(config, new Uint8Array([1, 2, 3, 4]).buffer, 200, { 'content-type': 'application/pdf' });
  await fireEvent.press(view.getByRole('button', { name: 'View 1.pdf' }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  await fireEvent.press(view.getByRole('button', { name: 'Remove 1.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'View 1.pdf' })).toBeNull());
  expect(
    sent.filter((config) => config.method === 'post' || config.method === 'delete').map((config) => config.url),
  ).toEqual([`${DETAIL}documents/`, `${DETAIL}documents/document-a/`]);
});

it('retains the chosen private copy and open draft after a foreign company upload receipt', async () => {
  wrongUpload = true;
  const view = await chooseDocument();
  const invalidated = jest.spyOn(client, 'invalidateQueries');
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await view.findByText('The document upload could not be confirmed. Refresh before retrying.');
  expect(view.getByText('1.pdf')).toBeTruthy();
  expect(current.documents).toEqual([]);
  expect(invalidated).not.toHaveBeenCalled();
  expect(Array.from(files.keys()).some((uri) => uri.includes('ledova-upload-copies'))).toBe(true);
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  expect(Array.from(files.keys()).filter((uri) => uri.includes('ledova-upload-copies'))).toEqual([]);
});

it('keeps an offered document after the real server removal refusal', async () => {
  const view = await chooseDocument();
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await view.findByRole('button', { name: 'Remove 1.pdf' });
  const retained = [...current.documents];
  refuseDelete = true;
  await fireEvent.press(view.getByRole('button', { name: 'Remove 1.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Confirm removal' }));
  await view.findByText('This offered document must be retained.');
  expect(current.documents).toEqual(retained);
  expect(view.getByRole('button', { name: 'View 1.pdf' })).toBeTruthy();
});

it.each(['authority', 'account', 'selection', 'unmount'] as const)(
  'does not share a held file receipt after %s is retired',
  async (change) => {
    multiple = change === 'selection';
    const view = await chooseDocument();
    await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
    await view.findByRole('button', { name: 'View 1.pdf' });
    const entered = deferred<InternalAxiosRequestConfig>();
    const held = deferred<ReturnType<typeof response>>();
    fileControl = async (config) => {
      entered.resolve(config);
      return held.promise;
    };
    await fireEvent.press(view.getByRole('button', { name: 'View 1.pdf' }));
    const request = await entered.promise;
    if (change === 'authority') {
      current = { ...current, administrativeAccess: { capabilities: [], draftSetup: false } };
      await act(() => client.invalidateQueries({ queryKey: ['companies'] }));
    }
    if (change === 'account')
      await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor', 'b') }));
    if (change === 'selection')
      await fireEvent.press(view.getByRole('button', { name: 'Select company Second Company' }));
    if (change === 'unmount') await view.unmount();
    await act(async () => {
      held.resolve(response(request, new Uint8Array([1, 2]).buffer, 200, { 'content-type': 'application/pdf' }));
      await held.promise;
    });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(Array.from(files.keys()).filter((uri) => uri.startsWith(`${cache}ledova-document-views`))).toEqual([]);
  },
);

it.each([
  ['personal prepare only', false, ['prepare']],
  ['delegation-only admin has no personal admin', false, []],
  ['revoked owner has no personal mandate', true, []],
  ['company role alone has no company mandate', false, []],
] as const)('refuses basic edit and document effects for %s', async (_, isOwner, capabilities) => {
  current = companyDetail({ isOwner, administrativeAccess: { capabilities: [...capabilities], draftSetup: false } });
  client = companyQueryClient(isOwner ? 'investor' : 'company');
  const view = await render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <CompanyScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await view.findByText('No company administration available.');
  expect(view.queryByRole('button', { name: 'Edit company' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Upload Certificate of Incorporation' })).toBeNull();
  expect(sent.some((request) => request.url === DETAIL || ['patch', 'post', 'delete'].includes(request.method!))).toBe(
    false,
  );
});

it('permits genuine owner draft setup without a personal appointment and keeps owner business widgets closed for an investor', async () => {
  current = companyDetail({ isOwner: true, administrativeAccess: { capabilities: [], draftSetup: true } });
  const view = await edit();
  expect(view.queryByRole('button', { name: 'Create share class' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.queryByLabelText('Phone')).toBeNull());
  expect(sent.filter((request) => request.method === 'patch')).toHaveLength(1);
});

it('blocks a queued edit while the actual current detail refresh remains pending', async () => {
  const view = await edit();
  const entered = deferred<void>();
  const bearer = deferred<void>();
  let first = true;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
    if (first && key === 'session.tokens.v2') {
      first = false;
      entered.resolve();
      await bearer.promise;
    }
    return tokens.get(key) ?? null;
  });
  const fresh = deferred<ReturnType<typeof response>>();
  const detailEntered = deferred<InternalAxiosRequestConfig>();
  const patch = jest.spyOn(apiClient, 'patch');
  try {
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
    await entered.promise;
    detailControl = async (config) => {
      detailEntered.resolve(config);
      return fresh.promise;
    };
    let refresh!: Promise<void>;
    await act(() => {
      refresh = client.invalidateQueries({ queryKey: ['company'] });
    });
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['company'] })
          .some((query) => query.state.fetchStatus === 'fetching'),
      ).toBe(true),
    );
    const refusal = expect(patch.mock.results[0].value).rejects.toThrow();
    await act(async () => {
      bearer.resolve();
      await refusal;
    });
    expect(sent.filter((config) => config.method === 'patch')).toHaveLength(0);
    const request = await detailEntered.promise;
    await act(async () => {
      fresh.resolve(response(request, current));
      await refresh;
    });
    await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled());
  } finally {
    bearer.resolve();
    fresh.resolve(response({} as InternalAxiosRequestConfig, current));
    patch.mockRestore();
  }
});

it('retains an upload draft and private copy through actual company read refusal, then retries after a fresh receipt', async () => {
  const view = await chooseDocument();
  const copies = Array.from(files.keys()).filter((uri) => uri.includes('ledova-upload-copies'));
  expect(copies).toHaveLength(1);
  failDetail = true;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Upload document' })).toBeDisabled());
  expect(view.getByText('1.pdf')).toBeTruthy();
  expect(copies.every((uri) => files.has(uri))).toBe(true);
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
  failDetail = false;
  await fireEvent.press(view.getAllByRole('button', { name: 'Retry company information' })[0]);
  await waitFor(() => expect(view.getByRole('button', { name: 'Upload document' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await view.findByRole('button', { name: 'View 1.pdf' });
  expect(copies.every((uri) => !files.has(uri))).toBe(true);
});

function retainedPress(view: Awaited<ReturnType<typeof screen>>, name: string) {
  const button = view.getByRole('button', { name });
  let fiber: typeof button.unstable_fiber | null = button.unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  const callback = fiber?.memoizedProps.onPress;
  expect(typeof callback).toBe('function');
  return callback;
}

it('consumes a closed document confirmation and refuses its retained callback', async () => {
  const view = await chooseDocument();
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await fireEvent.press(await view.findByRole('button', { name: 'Remove 1.pdf' }));
  const confirm = retainedPress(view, 'Confirm removal');
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  await act(() => confirm());
  expect(sent.filter((config) => config.method === 'delete')).toHaveLength(0);
  expect(current.documents).toHaveLength(1);
});

it('retires a cancelled document confirmation when the same document is reopened', async () => {
  const view = await chooseDocument();
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await fireEvent.press(await view.findByRole('button', { name: 'Remove 1.pdf' }));
  const old = retainedPress(view, 'Confirm removal');
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  await fireEvent.press(view.getByRole('button', { name: 'Remove 1.pdf' }));
  await act(() => old());
  expect(sent.filter((config) => config.method === 'delete')).toHaveLength(0);
  expect(current.documents).toHaveLength(1);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm removal' })).toBeNull());
  expect(sent.filter((config) => config.method === 'delete')).toHaveLength(1);
  expect(current.documents).toHaveLength(0);
});

it('retires a closed upload copy and refuses the old held submit callback', async () => {
  const view = await chooseDocument();
  const submit = retainedPress(view, 'Upload document');
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  await act(() => submit());
  expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
  expect(Array.from(files.keys()).filter((uri) => uri.includes('ledova-upload-copies'))).toEqual([]);
});

it.each(['account', 'selection', 'unmount'] as const)(
  'refuses a queued upload after %s retirement and cleans its private copy',
  async (change) => {
    multiple = change === 'selection';
    const view = await chooseDocument();
    const entered = deferred<void>();
    const held = deferred<void>();
    let first = true;
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (first && key === 'session.tokens.v2') {
        first = false;
        entered.resolve();
        await held.promise;
      }
      return tokens.get(key) ?? null;
    });
    const post = jest.spyOn(apiClient, 'post');
    try {
      await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
      await entered.promise;
      const refusal = expect(post.mock.results[0].value).rejects.toThrow();
      if (change === 'account')
        await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor', 'b') }));
      if (change === 'selection')
        await fireEvent.press(view.getByRole('button', { name: 'Select company Second Company' }));
      if (change === 'unmount') await view.unmount();
      await act(async () => {
        held.resolve();
        await refusal;
      });
      await waitFor(() =>
        expect(Array.from(files.keys()).filter((uri) => uri.includes('ledova-upload-copies'))).toEqual([]),
      );
      expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
      expect(current.documents).toEqual([]);
    } finally {
      held.resolve();
      post.mockRestore();
    }
  },
);

it('refuses a held document receipt after list-only admin loss while the same company owner remains selected', async () => {
  current = companyDetail({ isOwner: true });
  client = companyQueryClient('company');
  const view = await chooseDocument();
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await view.findByRole('button', { name: 'View 1.pdf' });
  const entered = deferred<InternalAxiosRequestConfig>();
  const held = deferred<ReturnType<typeof response>>();
  fileControl = async (config) => {
    entered.resolve(config);
    return held.promise;
  };
  await fireEvent.press(view.getByRole('button', { name: 'View 1.pdf' }));
  const request = await entered.promise;
  const cached = client.getQueryCache().findAll({ queryKey: ['company'] })[0]!.state.data;
  current = { ...current, administrativeAccess: { capabilities: [], draftSetup: false } };
  await act(() => client.invalidateQueries({ queryKey: ['companies'] }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'View 1.pdf' })).toBeNull());
  expect(view.getByRole('button', { name: 'Application' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Create share class' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Edit company' })).toBeNull();
  expect(client.getQueryCache().findAll({ queryKey: ['company'] })[0]!.state.data).toEqual(cached);
  expect(request.ledovaSubmissionGuard).toThrow();
  await act(async () => {
    held.resolve(response(request, new Uint8Array([1, 2]).buffer, 200, { 'content-type': 'application/pdf' }));
    await held.promise;
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(Array.from(files.keys()).filter((uri) => uri.startsWith(`${cache}ledova-document-views`))).toEqual([]);
});
