/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import axios from 'axios';
import { useRegisterImportDecision } from '../../src/hooks/useRegisterImportDecision';

const DIGEST = 'a'.repeat(64);
const SESSION = { timeout: 1000, ledovaSessionEpoch: 4 };
const PREVIEW = {
  previewDigest: DIGEST,
  unmetRequirements: [],
  canDecide: true,
  opensRegister: false,
  registerSequence: 1,
  comparison: [],
  statedTotal: '100',
  statedMemberCount: 1,
  importedTotal: '100',
  importedMemberCount: 1,
};

function applied(key: string) {
  return {
    uuid: 'import-a',
    status: 'applied',
    stage: 'applied',
    reviewedAt: '2026-10-05T00:00:00Z',
    rejectionReason: '',
    members: [],
    formerMembers: [],
    decisions: [
      {
        uuid: 'decision-a',
        kind: 'apply',
        appointment: 'appointment-a',
        idempotencyKey: key,
        digest: DIGEST,
        reason: '',
        decidedAt: '2026-10-05T00:00:00Z',
        decidedBy: 1,
        decidedByName: 'Synthetic Applier',
      },
    ],
  };
}

function setup() {
  const api = axios.create();
  const post = jest.spyOn(api, 'post');
  const keys = ['key-1', 'key-2', 'key-3'];
  const onDecided = jest.fn();
  const onRefused = jest.fn();
  const guard = jest.fn();
  const hook = renderHook(() =>
    useRegisterImportDecision(
      api,
      { uuid: 'import-a' },
      {
        appointment: 'appointment-a',
        newKey: () => keys.shift()!,
        guard,
        requestConfig: () => SESSION,
        onDecided,
        onRefused,
      },
    ),
  );
  return { post, hook, onDecided, onRefused, guard };
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('previews, then records exactly the previewed decision and confirms its receipt', async () => {
  const { post, hook, onDecided } = setup();
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: applied('key-1') });
  await act(() => hook.result.current.open('apply'));
  expect(hook.result.current.target?.request).toEqual({
    appointment: 'appointment-a',
    kind: 'apply',
    reason: '',
    idempotencyKey: 'key-1',
    previewDigest: DIGEST,
    confirmation: true,
  });
  await act(() => hook.result.current.confirm());
  expect(post.mock.calls[0]).toEqual([
    '/api/v1/tokens/register-imports/import-a/decision-preview/',
    { appointment: 'appointment-a', kind: 'apply', reason: '' },
    SESSION,
  ]);
  const [path, , config] = post.mock.calls[1]!;
  expect(path).toBe('/api/v1/tokens/register-imports/import-a/decide/');
  expect(config).toEqual(expect.objectContaining(SESSION));
  expect(onDecided).toHaveBeenCalledWith(applied('key-1'));
  expect(hook.result.current.target).toBeNull();
  expect(hook.result.current.error).toBeNull();
});

it('retries an unconfirmed decision with the same key and takes a new key for a changed preview', async () => {
  const { post, hook } = setup();
  post
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockResolvedValueOnce({ data: { ...PREVIEW, previewDigest: 'b'.repeat(64) } });
  await act(() => hook.result.current.open('apply'));
  await act(() => hook.result.current.confirm());
  expect(hook.result.current.error).toBeTruthy();
  await act(() => hook.result.current.open('apply'));
  expect(hook.result.current.target?.request.idempotencyKey).toBe('key-1');
  await act(() => hook.result.current.open('apply'));
  expect(hook.result.current.target?.request.idempotencyKey).toBe('key-2');
});

it('refuses an unconfirmed receipt and refreshes after a refusal', async () => {
  const { post, hook, onDecided, onRefused } = setup();
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: applied('another-key') });
  await act(() => hook.result.current.open('apply'));
  await act(() => hook.result.current.confirm());
  expect(onDecided).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBe('The decision could not be confirmed. Refresh before retrying.');
  post.mockResolvedValueOnce({ data: PREVIEW }).mockRejectedValueOnce({ response: { status: 409, data: {} } });
  await act(() => hook.result.current.open('apply'));
  await act(() => hook.result.current.confirm());
  expect(onRefused).toHaveBeenCalledTimes(1);
});

it('words a refusal by the requirements the server found unmet', async () => {
  const { post, hook, onRefused } = setup();
  post
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce({ response: { status: 400, data: { unmetRequirements: ['approval_lapsed'] } } });
  await act(() => hook.result.current.open('apply'));
  await act(() => hook.result.current.confirm());
  expect(hook.result.current.error).toBe(
    "The approver's appointment has ended. Approve this import again before applying it.",
  );
  expect(onRefused).toHaveBeenCalledTimes(1);
});

it('records nothing when the guard refuses or the preview lists unmet requirements', async () => {
  const { post, hook, guard } = setup();
  post.mockResolvedValueOnce({ data: { ...PREVIEW, canDecide: false, unmetRequirements: ['approval_required'] } });
  await act(() => hook.result.current.open('apply'));
  await act(() => hook.result.current.confirm());
  expect(post).toHaveBeenCalledTimes(1);
  guard.mockImplementation(() => {
    throw new Error('Your signed-in account changed.');
  });
  await act(() => hook.result.current.open('apply'));
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.error).toBe('Your signed-in account changed.');
});
