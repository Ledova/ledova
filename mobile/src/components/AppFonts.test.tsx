import React from 'react';
import { Text } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { loadAsync } from 'expo-font';
import { AppFonts } from './AppFonts';

jest.mock('expo-font', () => ({ loadAsync: jest.fn() }));
const load = jest.mocked(loadAsync);

beforeEach(() => {
  load.mockReset();
});

afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

it('holds the app until all bundled families load', async () => {
  let finish!: () => void;
  load.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  const view = await render(
    <AppFonts>
      <Text>Holdings</Text>
    </AppFonts>,
  );
  expect(view.getByText('Opening Ledova…')).toBeTruthy();
  expect(view.queryByText('Holdings')).toBeNull();
  expect(Object.keys(load.mock.calls[0][0])).toEqual([
    'Newsreader_500Medium',
    'InstrumentSans_400Regular',
    'InstrumentSans_500Medium',
    'InstrumentSans_600SemiBold',
    'InstrumentSans_700Bold',
  ]);
  await act(async () => finish());
  expect(view.getByText('Holdings')).toBeTruthy();
  expect(view.queryByText('Opening Ledova…')).toBeNull();
});

it('offers a working retry after the font loader rejects', async () => {
  load.mockRejectedValueOnce(new Error('Font unavailable')).mockResolvedValueOnce();
  const view = await render(
    <AppFonts>
      <Text>Holdings</Text>
    </AppFonts>,
  );
  expect(await view.findByRole('alert')).toHaveTextContent("We couldn't load the app's fonts.");
  expect(view.queryByText('Holdings')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(await view.findByText('Holdings')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});

it('times out a hanging load and ignores its late success while a retry is pending', async () => {
  jest.useFakeTimers();
  let late!: () => void;
  let finish!: () => void;
  load
    .mockReturnValueOnce(new Promise<void>((resolve) => (late = resolve)))
    .mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
  const view = await render(
    <AppFonts>
      <Text>Holdings</Text>
    </AppFonts>,
  );
  await act(async () => jest.advanceTimersByTime(20000));
  expect(view.getByRole('alert')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  await act(async () => late());
  expect(view.getByText('Opening Ledova…')).toBeTruthy();
  expect(view.queryByText('Holdings')).toBeNull();
  await act(async () => finish());
  expect(view.getByText('Holdings')).toBeTruthy();
});
