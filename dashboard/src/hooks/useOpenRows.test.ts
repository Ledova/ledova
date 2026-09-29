// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useOpenRows } from './useOpenRows';

afterEach(cleanup);

it('starts with every row closed and opens and closes each row on its own', () => {
  const { result } = renderHook(() => useOpenRows());
  expect(result.current.isOpen('first')).toBe(false);
  expect(result.current.isOpen('second')).toBe(false);

  act(() => result.current.toggle('first'));
  expect(result.current.isOpen('first')).toBe(true);
  expect(result.current.isOpen('second')).toBe(false);

  act(() => result.current.toggle('second'));
  expect(result.current.isOpen('first')).toBe(true);
  expect(result.current.isOpen('second')).toBe(true);

  act(() => result.current.toggle('first'));
  expect(result.current.isOpen('first')).toBe(false);
  expect(result.current.isOpen('second')).toBe(true);
});

it('applies every toggle made in one update', () => {
  const { result } = renderHook(() => useOpenRows());
  act(() => {
    result.current.toggle('first');
    result.current.toggle('second');
    result.current.toggle('third');
    result.current.toggle('third');
  });
  expect(result.current.isOpen('first')).toBe(true);
  expect(result.current.isOpen('second')).toBe(true);
  expect(result.current.isOpen('third')).toBe(false);
});

it('closes every open row at once, and each can open again after', () => {
  const { result } = renderHook(() => useOpenRows());
  act(() => {
    result.current.toggle('first');
    result.current.toggle('second');
  });

  act(() => result.current.closeAll());
  expect(result.current.isOpen('first')).toBe(false);
  expect(result.current.isOpen('second')).toBe(false);

  act(() => result.current.toggle('second'));
  expect(result.current.isOpen('first')).toBe(false);
  expect(result.current.isOpen('second')).toBe(true);
});
