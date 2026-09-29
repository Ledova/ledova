// @vitest-environment jsdom

import { useEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useOpenRows } from './useOpenRows';

const RENDER_LIMIT = 20;

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

it('keeps itself and its functions across renders until a row opens or closes', () => {
  const { result, rerender } = renderHook(() => useOpenRows());
  const initial = result.current;
  rerender();
  expect(result.current).toBe(initial);

  act(() => result.current.toggle('first'));
  expect(result.current).not.toBe(initial);
  expect(result.current.isOpen).not.toBe(initial.isOpen);
  expect(result.current.toggle).toBe(initial.toggle);
  expect(result.current.closeAll).toBe(initial.closeAll);

  const opened = result.current;
  rerender();
  expect(result.current).toBe(opened);

  act(() => result.current.closeAll());
  expect(result.current.toggle).toBe(initial.toggle);
  expect(result.current.closeAll).toBe(initial.closeAll);
});

it('changes nothing and renders nothing when closing with no row open', () => {
  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    return useOpenRows();
  });
  const initial = result.current;

  act(() => result.current.closeAll());
  expect(result.current).toBe(initial);
  expect(renders).toBe(1);
});

it('lets an effect that depends on the rows close them without looping', () => {
  let renders = 0;
  const { result } = renderHook(() => {
    const rows = useOpenRows();
    useEffect(() => rows.closeAll(), [rows]);
    renders += 1;
    if (renders > RENDER_LIMIT) throw new Error('The rows kept rendering');
    return rows;
  });
  expect(renders).toBe(1);

  act(() => result.current.toggle('first'));
  expect(result.current.isOpen('first')).toBe(false);
  expect(renders).toBeLessThanOrEqual(5);
});
