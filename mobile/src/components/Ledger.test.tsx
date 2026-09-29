import React from 'react';
import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, renderHook } from '@testing-library/react-native';
import { useAppTheme } from '../contexts';
import { Choice, LinkRow, Row, Rows, SwitchRow } from './Ledger';

afterEach(async () => {
  await cleanup();
});

it('draws a rule between rows only, never above the first or below the last', async () => {
  const view = await render(
    <Rows>
      <Row label="First">1</Row>
      {false}
      <>
        <Row label="Second">2</Row>
        <Row label="Third">3</Row>
      </>
      {null}
    </Rows>,
  );
  const first = view.getByText('First').parent!;
  const [head, rule, second, otherRule, last] = first.parent!.children;
  expect(first.parent!.children).toHaveLength(5);
  expect(head).toBe(first);
  expect(rule).toHaveStyle({ height: 1 });
  expect(second).toBe(view.getByText('Second').parent);
  expect(otherRule).toHaveStyle({ height: 1 });
  expect(last).toBe(view.getByText('Third').parent);
  expect(first).not.toHaveStyle({ borderBottomWidth: 1 });
  expect(last).not.toHaveStyle({ borderBottomWidth: 1 });
});

it('sets a mono row value in the theme mono face and leaves others in the text face', async () => {
  const theme = await renderHook(() => useAppTheme());
  const { mono, regular } = theme.result.current.fontFamily;
  const view = await render(
    <Rows>
      <Row label="From" mono>
        0x1111...2222
      </Row>
      <Row label="Amount">1 ETH</Row>
    </Rows>,
  );
  expect(view.getByText('0x1111...2222')).toHaveStyle({ fontFamily: mono });
  expect(view.getByText('1 ETH')).toHaveStyle({ fontFamily: regular });
  expect(view.getByText('From')).toHaveStyle({ fontFamily: regular });
});

it('draws no rule around a single row or link', async () => {
  const open = jest.fn();
  const view = await render(
    <Rows>
      <LinkRow label="Share class" accessibilityLabel="Open Ordinary shares" onPress={open} />
    </Rows>,
  );
  const link = view.getByRole('button', { name: 'Open Ordinary shares' });
  expect(link.parent!.children).toEqual([link]);
  expect(link).not.toHaveStyle({ borderBottomWidth: 1 });
  await fireEvent.press(link);
  expect(open).toHaveBeenCalledTimes(1);
});

it('marks the chosen option by its border, text and accessibility state', async () => {
  const pick = jest.fn();
  const view = await render(
    <>
      <Choice label="All" selected onPress={pick} />
      <Choice
        label="Base"
        selected={false}
        accessibilityRole="radio"
        accessibilityLabel="Base network"
        onPress={pick}
      />
    </>,
  );
  const chosen = StyleSheet.flatten(view.getByRole('button', { name: 'All', selected: true }).props.style);
  const other = view.getByRole('radio', { name: 'Base network', checked: false });
  expect(chosen.borderColor).not.toBe(StyleSheet.flatten(other.props.style).borderColor);
  expect(chosen.backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(view.getByText('All').props.style).color).not.toBe(
    StyleSheet.flatten(view.getByText('Base').props.style).color,
  );
  await fireEvent.press(other);
  expect(pick).toHaveBeenCalledTimes(1);
});

it('names the switch after its label, hints its sentence and shows the saved value', async () => {
  const view = await render(
    <SwitchRow
      label="Transaction alerts"
      description="Notifications for transaction status changes."
      checked
      onChange={jest.fn()}
    />,
  );
  const control = view.getByLabelText('Transaction alerts');
  expect(control.props.value).toBe(true);
  expect(control.props.accessibilityHint).toBe('Notifications for transaction status changes.');
  expect(view.getByText('Transaction alerts')).toBeTruthy();
  expect(view.getByText('Notifications for transaction status changes.')).toBeTruthy();

  await view.rerender(<SwitchRow label="Transaction alerts" checked={false} onChange={jest.fn()} />);
  expect(view.getByLabelText('Transaction alerts').props.value).toBe(false);
  expect(view.getByLabelText('Transaction alerts').props.accessibilityHint).toBeUndefined();
  expect(view.queryByText('Notifications for transaction status changes.')).toBeNull();
});

it('asks for the value it is switched to, and is disabled when told', async () => {
  const change = jest.fn();
  const view = await render(<SwitchRow label="Directory" checked={false} onChange={change} />);
  expect(view.getByLabelText('Directory').props.disabled).toBe(false);
  await fireEvent(view.getByLabelText('Directory'), 'valueChange', true);
  expect(change).toHaveBeenCalledWith(true);

  await view.rerender(<SwitchRow label="Directory" checked onChange={change} disabled />);
  expect(view.getByLabelText('Directory').props.disabled).toBe(true);
});
