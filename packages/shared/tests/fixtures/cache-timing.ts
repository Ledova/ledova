import { act } from '@testing-library/react';
import { focusManager, type QueryClient, type QueryKey } from '@tanstack/react-query';

const MARGIN = 1000;

async function elapse(time: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(time);
  });
}

async function returnAfter(time: number) {
  act(() => focusManager.setFocused(false));
  await elapse(time);
  act(() => focusManager.setFocused(true));
  await elapse(0);
}

export async function readsAgainOnReturnOnlyAfter(time: number, reads: () => number) {
  const before = reads();
  try {
    await returnAfter(time - MARGIN);
    expect(reads()).toBe(before);
    await returnAfter(2 * MARGIN);
    expect(reads()).toBe(before + 1);
  } finally {
    act(() => focusManager.setFocused(undefined));
  }
}

export async function keepsAfterClosingFor(time: number, client: QueryClient, queryKey: QueryKey, close: () => void) {
  close();
  await elapse(time - MARGIN);
  expect(client.getQueryCache().find({ queryKey })).toBeDefined();
  await elapse(2 * MARGIN);
  expect(client.getQueryCache().find({ queryKey })).toBeUndefined();
}
