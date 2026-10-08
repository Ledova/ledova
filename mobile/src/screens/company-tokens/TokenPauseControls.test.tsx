import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import type { SavedPause } from '@ledova/shared';
import { pauseSubmissionStore } from '../../services/pauseSubmissions';
import { items, owner, pauseResponse, resetPauseStorage, tokenUuid } from '../../testSupport/pauseRequests';
import { TokenPauseControls } from './TokenPauseControls';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
let client: QueryClient;
let completed: boolean;
let uuidIndex: number;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function screen(status: 'deployed' | 'paused' = 'deployed', refreshing = false) {
  return <TokenPauseControls token={{ uuid: tokenUuid, status }} refreshing={refreshing} />;
}
async function firstRecord() {
  const records = await pauseSubmissionStore.list(owner, tokenUuid);
  expect(records).toHaveLength(1);
  return records[0];
}
beforeEach(async () => {
  resetPauseStorage();
  uuidIndex = 0;
  await pauseSubmissionStore.retain({
    ...owner,
    tokenUuid,
    paused: true,
    submissionId: '44444444-4444-4444-8444-000000000001',
  });
  completed = false;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `44444444-4444-4444-8444-${String(++uuidIndex).padStart(12, '0')}`);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: owner.userUuid, userAccount: { uuid: owner.ownerAccountUuid } },
  });
  get.mockReset();
  get.mockImplementation(async (url) => {
    const record = (await pauseSubmissionStore.list(owner, tokenUuid)).find(
      (item) => url === URLS.PAUSE_SUBMISSION(tokenUuid, item.submissionId),
    );
    if (!record) throw new Error('No saved request');
    return pauseResponse(record, completed);
  });
  post.mockReset();
  post.mockImplementation(async (_url, body) => {
    const record = (await pauseSubmissionStore.list(owner, tokenUuid)).find(
      (item) => item.submissionId === (body as { submissionId: string }).submissionId,
    );
    expect(record).toBeDefined();
    return pauseResponse(record!, completed);
  });
});
afterEach(async () => {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await cleanup();
  client.clear();
});

it('retains existing terms before replay, carries session guards and keeps pending distinct from current class state', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
  await fireEvent.press(view.getByText('Retry same request'));
  expect(await view.findByText(/Pause request retained/)).toBeTruthy();
  const record = await firstRecord();
  expect(post).toHaveBeenCalledWith(
    URLS.PAUSE(tokenUuid),
    { submissionId: record.submissionId },
    {
      ledovaSessionEpoch: getSessionEpoch(),
      ledovaSubmissionGuard: expect.any(Function),
    },
  );
  expect(view.queryByText('Pause')).toBeNull();
  expect(view.queryByText('Dismiss outcome')).toBeNull();
  expect(view.queryByText('Transfers are paused.')).toBeNull();
});

it('recovers a lost response after remount with exactly the same submission and terms', async () => {
  post.mockRejectedValueOnce(new Error('Lost response'));
  const first = await render(screen(), { wrapper });
  await waitFor(() => expect(first.getByText('Retry same request')).toBeEnabled());
  await fireEvent.press(first.getByText('Retry same request'));
  await first.findByText('Lost response');
  const original = await firstRecord();
  await first.unmount();
  const view = await render(screen(), { wrapper });
  await view.findByText(`Pause request ${original.submissionId}`);
  expect(post).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][1]).toEqual({ submissionId: original.submissionId });
  expect(await firstRecord()).toEqual(original);
});

it('offers no fresh owner button during class refresh and prevents duplicate original replays', async () => {
  let release!: (value: ReturnType<typeof pauseResponse>) => void;
  post.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = await render(screen('deployed', true), { wrapper });
  expect(await view.findByText('Refreshing the current share class…')).toBeTruthy();
  expect(view.queryByText('Pause')).toBeNull();
  expect(post).not.toHaveBeenCalled();
  await view.rerender(screen());
  await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await fireEvent.press(view.getByText('Retry same request'));
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => release(pauseResponse(await firstRecord())));
});

it('keeps a completed original outcome separate from a later class state and removes only its reminder', async () => {
  const original = await firstRecord();
  completed = true;
  const first = await render(screen('deployed'), { wrapper });
  await first.findByText(/original pause transaction was confirmed/);
  expect(first.queryByText('Pause')).toBeNull();
  await first.unmount();
  const newer = { ...original, submissionId: '55555555-5555-4555-8555-555555555555' };
  await pauseSubmissionStore.retain(newer);
  get.mockImplementation(async (url) =>
    pauseResponse(url.includes(original.submissionId) ? original : newer, url.includes(original.submissionId)),
  );
  const view = await render(screen('deployed'), { wrapper });
  await view.findByText(`Pause request ${newer.submissionId}`);
  await waitFor(() => expect(view.getAllByText('Retry same request')).toHaveLength(1));
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(await pauseSubmissionStore.list(owner, tokenUuid)).toHaveLength(2);
  expect(post.mock.calls[0][1]).not.toEqual({ submissionId: original.submissionId });
  await waitFor(() => expect(view.getAllByText('Dismiss outcome')).toHaveLength(2));
  await fireEvent.press(view.getAllByText('Dismiss outcome')[0]);
  await waitFor(async () => expect(await pauseSubmissionStore.list(owner, tokenUuid)).toHaveLength(1));
  expect(post).toHaveBeenCalledTimes(1);
});

it('recovers an unpause refusal without changing its requested direction', async () => {
  const refusal = (original: SavedPause) => ({
    ...pauseResponse(original, true),
    data: {
      ...pauseResponse(original, true).data,
      message: 'The original unpause request was refused before signing.',
      submission: { ...pauseResponse(original, true).data.submission, status: 'failed' },
    },
  });
  const saved = await firstRecord();
  await pauseSubmissionStore.remove(saved);
  await pauseSubmissionStore.retain({ ...saved, paused: false });
  let refused = false;
  get.mockImplementation(async () => (refused ? refusal(await firstRecord()) : pauseResponse(await firstRecord())));
  post.mockImplementation(async (_url, body) => {
    const original = await firstRecord();
    expect((body as { submissionId: string }).submissionId).toBe(original.submissionId);
    expect(original.paused).toBe(false);
    refused = true;
    return refusal(original);
  });
  const view = await render(screen('paused'), { wrapper });
  await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
  await fireEvent.press(view.getByText('Retry same request'));
  await view.findByText('The original unpause request was refused before signing.');
  expect(post.mock.calls[0][0]).toBe(URLS.UNPAUSE(tokenUuid));
  expect(view.getByText('Dismiss outcome')).toBeTruthy();
});

it('does not post when storage loses the write, then permits a deliberate retry after recovery', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
  items.clear();
  jest.mocked(AsyncStorage.setItem).mockResolvedValueOnce();
  await fireEvent.press(view.getByText('Retry same request'));
  await view.findByText('The pause request could not be saved on this device.');
  expect(post).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
});

it('blocks new writes on corrupt saved records, then reloads repaired storage', async () => {
  const record = await firstRecord();
  const name = [...items.keys()][0];
  items.set(name, '{}');
  const view = await render(screen(), { wrapper });
  await view.findByText('Saved pause requests could not be read.');
  expect(view.queryByText('Pause')).toBeNull();
  expect(post).not.toHaveBeenCalled();
  items.set(name, JSON.stringify(record));
  await fireEvent.press(view.getByText('Reload saved requests'));
  await view.findByText(`Pause request ${record.submissionId}`);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  expect(post).not.toHaveBeenCalled();
});

it('restores a removed displayed request and refuses conflicting stored terms', async () => {
  const record = await firstRecord();
  const view = await render(screen(), { wrapper });
  await view.findByText(`Pause request ${record.submissionId}`);
  items.clear();
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(await firstRecord()).toEqual(record);
  const name = [...items.keys()][0];
  items.set(name, JSON.stringify({ ...record, paused: false }));
  await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
  await fireEvent.press(view.getByText('Retry same request'));
  await view.findByText('This saved pause request has different terms.');
  expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.parse(items.get(name)!)).toEqual({ ...record, paused: false });
});

it('retains recovery and blocks completion when the response describes a different submission', async () => {
  const record = await firstRecord();
  const wrong = { ...record, submissionId: '99999999-9999-4999-8999-999999999999' };
  get.mockResolvedValue(pauseResponse(wrong, true));
  post.mockResolvedValue(pauseResponse(wrong, true));
  const view = await render(screen(), { wrapper });
  await view.findByText('The server returned a different pause submission. The original request remains saved.');
  expect(view.queryByText('Dismiss outcome')).toBeNull();
  expect(view.queryByText('Pause')).toBeNull();
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(await firstRecord()).toEqual(record);
});

it.each(['account', 'epoch'] as const)(
  'rejects delayed results after a %s change while preserving recovery',
  async (change) => {
    let release!: (value: ReturnType<typeof pauseResponse>) => void;
    post.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = await render(screen(), { wrapper });
    await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
    await fireEvent.press(view.getByText('Retry same request'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const record = await firstRecord();
    await act(async () => {
      if (change === 'account')
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: {
            userProfile: owner.userUuid,
            userAccount: { uuid: '55555555-5555-4555-8555-555555555555' },
          },
        });
      else invalidateSessionScope();
      release(pauseResponse(record, true));
    });
    expect(view.queryByText(/original pause transaction was confirmed/)).toBeNull();
    expect(view.queryByText('Dismiss outcome')).toBeNull();
    expect(await firstRecord()).toEqual(record);
    if (change === 'account') expect(view.queryByText(`Pause request ${record.submissionId}`)).toBeNull();
  },
);

it('refuses a POST if the session changes while durable storage is awaited', async () => {
  let release!: () => void;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(
    (key, value) =>
      new Promise<void>((resolve) => {
        release = () => {
          items.set(key, value);
          resolve();
        };
      }),
  );
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText('Retry same request')).toBeEnabled());
  await fireEvent.press(view.getByText('Retry same request'));
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => {
    invalidateSessionScope();
    release();
  });
  expect(post).not.toHaveBeenCalled();
  await firstRecord();
});

it('refuses pause actions without an authenticated issuer session', async () => {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
  const view = await render(screen(), { wrapper });
  expect(view.getByText('Verify your issuer session before reading retained pause requests.')).toBeTruthy();
  expect(view.queryByText('Pause')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('keeps a never-admitted v1 reminder after explicit retirement refusal with no completion or regenerated UUID', async () => {
  const original = await firstRecord();
  post.mockRejectedValueOnce(new Error('New issuer pause requests are retired. Prepare a company pause instruction.'));
  const view = await render(screen(), { wrapper });
  await fireEvent.press(await view.findByText('Retry same request'));
  await view.findByText('New issuer pause requests are retired. Prepare a company pause instruction.');
  expect(await firstRecord()).toEqual(original);
  expect(post.mock.calls[0][1]).toEqual({ submissionId: original.submissionId });
  expect(view.queryByText('Dismiss outcome')).toBeNull();
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
});
