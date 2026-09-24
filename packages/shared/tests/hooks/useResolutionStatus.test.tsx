/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';

import { LONGEST_TIMER_DELAY } from '../../src/constants';
import { useResolutionStatus } from '../../src/hooks/useResolutionStatus';
import type { PublicationResult } from '../../src/types';

const START = Date.parse('2026-09-24T00:00:00Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const tally: PublicationResult = {
  for: { shares: '100', members: 1 },
  against: { shares: '40', members: 1 },
  abstain: { shares: '0', members: 0 },
  eligible: { shares: '150', members: 3 },
  carried: true,
};

const window = (opensIn: number, closesIn: number, result: PublicationResult | null = null) => ({
  opensAt: new Date(START + opensIn).toISOString(),
  closesAt: new Date(START + closesIn).toISOString(),
  result,
});

beforeEach(() => {
  jest.useFakeTimers({ now: START });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe('useResolutionStatus', () => {
  it('opens when the window opens and closes when it ends, with only the next change waiting', () => {
    const view = renderHook(() => useResolutionStatus(window(MINUTE, 2 * MINUTE)));

    expect(view.result.current).toBe('upcoming');
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(MINUTE - 1));
    expect(view.result.current).toBe('upcoming');
    act(() => jest.advanceTimersByTime(1));
    expect(view.result.current).toBe('open');
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(MINUTE));
    expect(view.result.current).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits no longer than a timer can hold, and re-arms until a far window opens', () => {
    const scheduled = jest.spyOn(globalThis, 'setTimeout');
    const view = renderHook(() => useResolutionStatus(window(60 * DAY, 61 * DAY)));

    expect(scheduled).toHaveBeenLastCalledWith(expect.any(Function), LONGEST_TIMER_DELAY);
    act(() => jest.advanceTimersByTime(LONGEST_TIMER_DELAY));
    expect(view.result.current).toBe('upcoming');
    expect(scheduled).toHaveBeenLastCalledWith(expect.any(Function), LONGEST_TIMER_DELAY);
    act(() => jest.advanceTimersByTime(LONGEST_TIMER_DELAY));
    expect(view.result.current).toBe('upcoming');
    expect(scheduled).toHaveBeenLastCalledWith(expect.any(Function), 60 * DAY - 2 * LONGEST_TIMER_DELAY);
    act(() => jest.advanceTimersByTime(60 * DAY - 2 * LONGEST_TIMER_DELAY - 1));
    expect(view.result.current).toBe('upcoming');
    act(() => jest.advanceTimersByTime(1));
    expect(view.result.current).toBe('open');
    scheduled.mockRestore();
  });

  it('stops waiting once the resolution has been counted, and when it leaves the page', () => {
    const view = renderHook(({ result }) => useResolutionStatus(window(-MINUTE, MINUTE, result)), {
      initialProps: { result: null as PublicationResult | null },
    });

    expect(view.result.current).toBe('open');
    expect(jest.getTimerCount()).toBe(1);
    view.rerender({ result: tally });
    expect(view.result.current).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
    view.rerender({ result: null });
    expect(jest.getTimerCount()).toBe(1);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps no clock for a publication with no voting window', () => {
    const view = renderHook(() => useResolutionStatus({ opensAt: null, closesAt: null, result: null }));

    expect(view.result.current).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
