// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY, COMPANY_TOKEN_ENDPOINTS } from '@ledova/shared';
import { listSavedPauses } from '@services/pauseSubmissions';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const providedApi = Object.assign(axios.create(), api);

import { TokenPauseControls } from './components/TokenPauseControls';

const tokenUuid = '11111111-1111-4111-8111-111111111111';
const owner = {
  userUuid: '22222222-2222-4222-8222-222222222222',
  ownerAccountUuid: '33333333-3333-4333-8333-333333333333',
};
let client: QueryClient;
let status: 'deployed' | 'paused';
let completed: boolean;
let id: string;

function response(submissionId = id) {
  return {
    status: completed ? 200 : 202,
    data: {
      message: completed
        ? 'The original pause transaction was confirmed. The token may have changed since then.'
        : 'Pause request retained. Its outcome is pending; this does not establish the current token state.',
      token: { uuid: tokenUuid, status },
      submission: {
        uuid: submissionId,
        paused: true,
        status: completed ? 'confirmed' : 'pending',
        completedAt: completed ? '2026-09-15T00:00:00Z' : null,
      },
    },
  };
}

function show() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={providedApi}>
        <TokenPauseControls token={{ uuid: tokenUuid, status }} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  completed = false;
  status = 'deployed';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: owner.userUuid, userAccount: { uuid: owner.ownerAccountUuid } },
  });
  api.get.mockImplementation(async () => response());
  api.post.mockImplementation(async (_url: string, body: { submissionId: string }) => {
    id = body.submissionId;
    expect(listSavedPauses(owner, tokenUuid)).toEqual([{ ...owner, tokenUuid, submissionId: id, paused: true }]);
    return response();
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('persists before posting and reports pending without claiming transfers stopped', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText(/Pause request retained/);
  expect(screen.queryByText('Token paused. Transfers and issuance are suspended.')).toBeNull();
  expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.post.mock.calls[0][0]).toBe(COMPANY_TOKEN_ENDPOINTS.PAUSE(tokenUuid));
  expect(screen.queryByRole('button', { name: 'Dismiss outcome' })).toBeNull();
});

it('recovers an uncertain post after remount and retries with the original identity', async () => {
  api.post.mockImplementationOnce(async (_url: string, body: { submissionId: string }) => {
    id = body.submissionId;
    throw new Error('Lost response');
  });
  const first = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const original = listSavedPauses(owner, tokenUuid)[0];
  first.unmount();
  show();
  await screen.findByText(`Pause request ${original.submissionId}`);
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1][1]).toEqual({ submissionId: original.submissionId });
  expect(listSavedPauses(owner, tokenUuid)).toHaveLength(1);
});

it('keeps an original completed outcome separate from a later current token state', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText(/Pause request retained/);
  completed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Check outcome' }));
  await screen.findByText(/original pause transaction was confirmed/);
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss outcome' }));
  await waitFor(() => expect(listSavedPauses(owner, tokenUuid)).toHaveLength(0));
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('cannot send when the identifier was not retained by storage', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByRole('alert');
  expect(api.post).not.toHaveBeenCalled();
  expect(listSavedPauses(owner, tokenUuid)).toHaveLength(0);
});

it('retains the displayed identity and refuses a retry whose storage write is lost', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText(/Pause request retained/);
  const original = id;
  localStorage.clear();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await screen.findByRole('alert');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByText(`Pause request ${original}`)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
});

it('restores the exact displayed request before retrying after its storage entry disappeared', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText(/Pause request retained/);
  const original = listSavedPauses(owner, tokenUuid)[0];
  localStorage.clear();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1][1]).toEqual({ submissionId: original.submissionId });
  expect(listSavedPauses(owner, tokenUuid)).toEqual([original]);
});

it('refuses to replace different stored terms with a displayed retry', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText(/Pause request retained/);
  const original = listSavedPauses(owner, tokenUuid)[0];
  const name = Object.keys(localStorage)[0];
  localStorage.setItem(name, JSON.stringify({ ...original, paused: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await screen.findByRole('alert');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(name)!)).toEqual({ ...original, paused: false });
});

it('does not erase recovery when the server responds with another submission', async () => {
  api.get.mockImplementation(async () => response('44444444-4444-4444-8444-444444444444'));
  api.post.mockImplementation(async (_url: string, body: { submissionId: string }) => {
    id = body.submissionId;
    return response('44444444-4444-4444-8444-444444444444');
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(listSavedPauses(owner, tokenUuid)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Dismiss outcome' })).toBeNull();
});

it('hides the old issuer requests on account change and rejects a delayed response', async () => {
  let release!: (value: ReturnType<typeof response>) => void;
  api.post.mockImplementation((_url: string, body: { submissionId: string }) => {
    id = body.submissionId;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: owner.userUuid, userAccount: { uuid: '55555555-5555-4555-8555-555555555555' } },
    }),
  );
  completed = true;
  await act(async () => release(response()));
  expect(screen.queryByText(`Pause request ${id}`)).toBeNull();
  expect(screen.queryByText(/original pause transaction was confirmed/)).toBeNull();
  expect(listSavedPauses(owner, tokenUuid)).toHaveLength(1);
});

it('retains both completed and newer requests instead of overwriting the older reminder', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText(/Pause request retained/);
  completed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Check outcome' }));
  await screen.findByRole('button', { name: 'Dismiss outcome' });
  completed = false;
  const original = id;
  api.post.mockImplementation(async (_url: string, body: { submissionId: string }) => {
    id = body.submissionId;
    return response();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(id).not.toBe(original);
  expect(listSavedPauses(owner, tokenUuid)).toHaveLength(2);
});

it('recovers a permanent unpause refusal and permits a later deliberate opposite request', async () => {
  status = 'paused';
  let refusedId: string;
  const refusal = () => ({
    status: 200,
    data: {
      ...response(refusedId).data,
      message: 'The original unpause request was refused before signing. A new request needs a new submission.',
      submission: {
        uuid: refusedId,
        paused: false,
        status: 'failed',
        completedAt: '2026-09-15T00:00:00Z',
      },
    },
  });
  api.post.mockImplementationOnce(async (_url: string, body: { submissionId: string }) => {
    refusedId = body.submissionId;
    expect(listSavedPauses(owner, tokenUuid)[0].paused).toBe(false);
    return refusal();
  });
  api.get.mockImplementation(async () => refusal());
  const first = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Unpause' }));
  await screen.findByText(/unpause request was refused before signing/);
  expect(api.post.mock.calls[0][0]).toBe(COMPANY_TOKEN_ENDPOINTS.UNPAUSE(tokenUuid));
  first.unmount();
  status = 'deployed';
  show();
  await screen.findByRole('button', { name: 'Dismiss outcome' });
  expect(api.post).toHaveBeenCalledTimes(1);
  api.post.mockImplementation(async (_url: string, body: { submissionId: string }) => {
    id = body.submissionId;
    return response();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1][0]).toBe(COMPANY_TOKEN_ENDPOINTS.PAUSE(tokenUuid));
  expect(id).not.toBe(refusedId!);
  expect(listSavedPauses(owner, tokenUuid)).toHaveLength(2);
});
