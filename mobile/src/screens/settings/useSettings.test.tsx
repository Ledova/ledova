import React from 'react';
import { Alert, Share } from 'react-native';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { deleteAccount } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { clearTokens } from '../../services/tokenStorage';
import { cache as cacheRoot, files, resetFiles } from '../../testSupport/documentFiles';
import { useSettings } from './useSettings';

const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset }) }));
jest.mock('@ledova/shared', () => ({ ...jest.requireActual('@ledova/shared'), deleteAccount: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ clearTokens: jest.fn() }));

const EXPORT = '/api/user-profiles/export-data/';
const COPY = new RegExp(`^${cacheRoot}ledova-document-views-v1/ledova-data-export-\\d{4}-\\d{2}-\\d{2}\\.json$`);
const exported = {
  exportedAt: '2026-09-24T00:00:00Z',
  transactions: [{ txHash: '0xsynthetic', nonce: 3, importedFromHistory: false, chainObservation: null }],
};

const account = ['account'];
let client: QueryClient;
let events: string[];

function cache() {
  return client.getQueryData(account) ? 'kept' : 'cleared';
}

beforeEach(() => {
  resetFiles();
  client = new QueryClient();
  client.setQueryData(account, { email: 'synthetic@example.test' });
  events = [];
  mockReset.mockImplementation(() => events.push(`navigate with cache ${cache()}`));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  jest.mocked(apiClient.get).mockResolvedValue({ data: exported });
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function startDeletion() {
  const { result } = await renderHook(() => useSettings(), { wrapper });
  let deletion!: Promise<boolean>;
  await act(async () => {
    deletion = result.current.deleteUserAccount();
    await new Promise((resolve) => setTimeout(resolve));
  });
  return { settings: result, deletion };
}

it.each([
  ['confirmed', undefined, []],
  [
    'unconfirmed',
    new Error('synthetic storage detail'),
    [
      [
        'Account Deleted',
        'Your account was deleted, but this device could not confirm that your saved sign-in was removed.',
      ],
    ],
  ],
])('completes a deletion the server accepted when local retirement is %s', async (_, failure, alerts) => {
  jest.mocked(deleteAccount).mockResolvedValue({} as Awaited<ReturnType<typeof deleteAccount>>);
  let settle!: () => void;
  jest.mocked(clearTokens).mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = () => {
          events.push(`retirement settled with cache ${cache()}`);
          if (failure) reject(failure);
          else resolve();
        };
      }),
  );

  const { settings, deletion } = await startDeletion();
  expect(settings.current.isDeleting).toBe(true);
  const deleted = await act(() => {
    settle();
    return deletion;
  });

  expect({ deleted, deleting: settings.current.isDeleting }).toEqual({ deleted: true, deleting: false });
  expect(events).toEqual(['retirement settled with cache kept', 'navigate with cache cleared']);
  expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'SignIn' }] });
  expect(jest.mocked(Alert.alert).mock.calls).toEqual(alerts);
});

it('reports a deletion the server refused and keeps the session', async () => {
  jest.mocked(deleteAccount).mockRejectedValue(new Error('synthetic refusal'));

  const { settings, deletion } = await startDeletion();
  expect({ deleted: await deletion, deleting: settings.current.isDeleting }).toEqual({
    deleted: false,
    deleting: false,
  });
  expect(clearTokens).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  expect(cache()).toBe('kept');
  expect(jest.mocked(Alert.alert).mock.calls).toEqual([
    ['Delete Failed', 'Unable to delete your account. Please try again later.'],
  ]);
});

async function runExport() {
  const { result } = await renderHook(() => useSettings(), { wrapper });
  let shared!: boolean;
  await act(async () => {
    shared = await result.current.exportData();
  });
  return { shared, exporting: result.current.isExporting };
}

it('hands the share sheet one private JSON file of the export, not a message', async () => {
  expect(await runExport()).toEqual({ shared: true, exporting: false });

  const copies = [...files.keys()];
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatch(COPY);
  expect(JSON.parse(files.get(copies[0])?.content ?? '')).toEqual(exported);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(copies[0], {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Ledova - Account Data Export',
  });
  expect(apiClient.get).toHaveBeenCalledWith(EXPORT, { ledovaSessionEpoch: getSessionEpoch() });
  expect(Share.share).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('writes and shares nothing when the export fails, and says so', async () => {
  jest.mocked(apiClient.get).mockRejectedValue({ response: { status: 500 } });

  expect(await runExport()).toEqual({ shared: false, exporting: false });

  expect(files.size).toBe(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(jest.mocked(Alert.alert).mock.calls).toEqual([
    ['Export Failed', 'Unable to export your data. Please try again later.'],
  ]);
});

it('keeps an export that outlives its session off the device and out of the share sheet', async () => {
  jest.mocked(apiClient.get).mockImplementation(async () => {
    invalidateSessionScope();
    return { data: exported };
  });

  expect(await runExport()).toEqual({ shared: false, exporting: false });

  expect(files.size).toBe(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('asks for nothing when the device cannot share a file', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);

  expect(await runExport()).toEqual({ shared: false, exporting: false });

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
  expect(jest.mocked(Alert.alert).mock.calls).toEqual([['Export Failed', 'Sharing is not available on this device.']]);
});
