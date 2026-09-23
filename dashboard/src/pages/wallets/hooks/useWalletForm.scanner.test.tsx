// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWalletForm } from './useWalletForm';

const camera = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    static getCameras = camera.list;
    start = camera.start;
    stop = camera.stop;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  camera.list.mockResolvedValue([{ id: 'synthetic-camera' }]);
  camera.start.mockResolvedValue(undefined);
  camera.stop.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

function mountForm() {
  return renderHook(() => useWalletForm({ onSubmit: vi.fn(), onBatchSubmit: vi.fn() }));
}

async function openScanner(result: ReturnType<typeof mountForm>['result']) {
  act(() => result.current.toggleScanner());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(101);
  });
}

it('stops the started camera when the scanner is hidden', async () => {
  const { result } = mountForm();
  await openScanner(result);
  expect(camera.start).toHaveBeenCalledOnce();
  expect(camera.stop).not.toHaveBeenCalled();
  act(() => result.current.toggleScanner());
  expect(result.current.showScanner).toBe(false);
  expect(camera.stop).toHaveBeenCalledOnce();
});

it('clears a camera failure when the scanner is hidden', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  camera.list.mockRejectedValue(new Error('denied'));
  const { result } = mountForm();
  await openScanner(result);
  expect(result.current.scannerError).toBe('Unable to access camera. Please check permissions.');
  act(() => result.current.toggleScanner());
  expect(result.current.scannerError).toBeNull();
  expect(result.current.scanProgress).toBeNull();
});

it('stops the started camera on unmount', async () => {
  const view = mountForm();
  await openScanner(view.result);
  view.unmount();
  expect(camera.stop).toHaveBeenCalledOnce();
});
