/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { REGISTER_RECONCILIATION_COPY as COPY } from '../../src/constants/business/register-reconciliations';
import { useDiscrepancyAcknowledgement } from '../../src/hooks/useDiscrepancyAcknowledgement';

const SESSION = { timeout: 1000, ledovaSessionEpoch: 4 };
const PATH = '/api/v1/tokens/register-reconciliations/reconciliation-a/acknowledge/';
const REASON = 'The directors accept the outside transfer';

function acknowledged(reason = REASON, appointment = 'appointment-a') {
  const row = { kind: 'member', member: 'member-a', chain: '10', expected: '5' };
  return {
    uuid: 'reconciliation-a',
    token: 'class-a',
    status: 'discrepant',
    latest: true,
    discrepancies: [
      { ...row, acknowledgeable: true, acknowledgement: null },
      {
        ...row,
        acknowledgeable: false,
        acknowledgement: {
          reason,
          appointment,
          acknowledgedByName: 'Synthetic Approver',
          acknowledgedAt: '2026-10-05T00:00:00Z',
          providedBy: 'company',
        },
      },
    ],
  };
}

function setup(appointment: string | null = 'appointment-a') {
  const api = axios.create();
  const post = jest.spyOn(api, 'post');
  const keys = ['key-1', 'key-2', 'key-3'];
  const onAcknowledged = jest.fn();
  const onRefused = jest.fn();
  const guard = jest.fn();
  const hook = renderHook(() =>
    useDiscrepancyAcknowledgement(
      api,
      { uuid: 'reconciliation-a' },
      {
        appointment: appointment ?? undefined,
        newKey: () => keys.shift()!,
        guard,
        requestConfig: () => SESSION,
        onAcknowledged,
        onRefused,
      },
    ),
  );
  return { post, hook, onAcknowledged, onRefused, guard };
}

function sentKeys(post: jest.SpyInstance) {
  return post.mock.calls.map(([, body]) => (body as { idempotencyKey: string }).idempotencyKey);
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('acknowledges the row with its reason under a retry key, confirms the receipt and reports it', async () => {
  const { post, hook, onAcknowledged, guard } = setup();
  post.mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  const [path, body, config] = post.mock.calls[0]!;
  expect(path).toBe(PATH);
  expect(body).toEqual({ appointment: 'appointment-a', discrepancy: 1, reason: REASON, idempotencyKey: 'key-1' });
  expect(config).toEqual({ ...SESSION, ledovaSubmissionGuard: guard });
  expect(onAcknowledged).toHaveBeenCalledWith(acknowledged());
  expect(guard).toHaveBeenCalledTimes(2);
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.busy).toBe(false);
});

it('retries an unanswered acknowledgement with the same key and takes a new key for a changed request', async () => {
  const { post, hook } = setup();
  post
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(hook.result.current.error).toBe('Network Error');
  await act(() => hook.result.current.acknowledge(1, REASON));
  await act(() => hook.result.current.acknowledge(1, 'Another reason'));
  await act(() => hook.result.current.acknowledge(0, 'Another reason'));
  expect(sentKeys(post)).toEqual(['key-1', 'key-1', 'key-2', 'key-3']);
});

it('keeps the retry key after a server failure, without a refresh', async () => {
  const { post, hook, onRefused } = setup();
  post.mockRejectedValueOnce({ response: { status: 502, data: {} } }).mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(hook.result.current.error).toBe(COPY.ACKNOWLEDGE_FAILED);
  expect(onRefused).not.toHaveBeenCalled();
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(sentKeys(post)).toEqual(['key-1', 'key-1']);
});

it.each([
  [400, ['This discrepancy is already acknowledged.'], 'This discrepancy is already acknowledged.'],
  [400, { reason: ['This field may not be blank.'] }, 'This field may not be blank.'],
  [404, { detail: 'Company appointment not found.' }, 'Company appointment not found.'],
  [409, { detail: 'The register operation conflicts.' }, 'The register operation conflicts.'],
])('words a %s refusal by what the server said, refreshes and takes a new key', async (status, data, sentence) => {
  const { post, hook, onRefused } = setup();
  post.mockRejectedValueOnce({ response: { status, data } }).mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(hook.result.current.error).toBe(sentence);
  expect(onRefused).toHaveBeenCalledTimes(1);
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(sentKeys(post)).toEqual(['key-1', 'key-2']);
});

it('holds the request busy until the refresh after a refusal settles', async () => {
  const { post, hook, onRefused } = setup();
  let finishRefresh = () => {};
  onRefused.mockReturnValueOnce(new Promise<void>((resolve) => (finishRefresh = resolve)));
  post.mockRejectedValueOnce({ response: { status: 400, data: ['This discrepancy is already acknowledged.'] } });
  let acknowledging: Promise<void> = Promise.resolve();
  act(() => {
    acknowledging = hook.result.current.acknowledge(1, REASON);
  });
  await waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    finishRefresh();
    await acknowledging;
  });
  expect(hook.result.current.busy).toBe(false);
});

it.each([
  ['another reason', acknowledged('Another reason')],
  ['another appointment', acknowledged(REASON, 'appointment-b')],
  ['no acknowledgement of the row', { ...acknowledged(), discrepancies: [acknowledged().discrepancies[0]] }],
])('refuses a receipt with %s, keeping its retry key and reporting nothing', async (_case, received) => {
  const { post, hook, onAcknowledged, onRefused } = setup();
  post.mockResolvedValueOnce({ data: received }).mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(onAcknowledged).not.toHaveBeenCalled();
  expect(onRefused).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBe(COPY.ACKNOWLEDGEMENT_RECEIPT_FAILED);
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(sentKeys(post)).toEqual(['key-1', 'key-1']);
});

it('sends nothing and consumes no retry key when the guard refuses before the request', async () => {
  const { post, hook, guard } = setup();
  guard.mockImplementationOnce(() => {
    throw new Error('Your signed-in account changed.');
  });
  post.mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(post).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBe('Your signed-in account changed.');
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(sentKeys(post)).toEqual(['key-1']);
});

it('reports no acknowledgement whose guard refuses once its response returns', async () => {
  const { post, hook, guard, onAcknowledged, onRefused } = setup();
  guard
    .mockImplementationOnce(() => undefined)
    .mockImplementationOnce(() => {
      throw new Error('Your signed-in account changed.');
    });
  post.mockResolvedValueOnce({ data: acknowledged() });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(post).toHaveBeenCalledTimes(1);
  expect(onAcknowledged).not.toHaveBeenCalled();
  expect(onRefused).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBe('Your signed-in account changed.');
});

it('sends nothing without an appointment for the step', async () => {
  const { post, hook } = setup(null);
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(post).not.toHaveBeenCalled();
});

it('sends one acknowledgement at a time', async () => {
  const { post, hook } = setup();
  let answer: (value: unknown) => void = () => {};
  post.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  let first: Promise<void> = Promise.resolve();
  act(() => {
    first = hook.result.current.acknowledge(1, REASON);
  });
  await act(() => hook.result.current.acknowledge(1, REASON));
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    answer({ data: acknowledged() });
    await first;
  });
  expect(hook.result.current.busy).toBe(false);
});
