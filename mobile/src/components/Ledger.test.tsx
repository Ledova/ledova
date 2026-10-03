import React, { createRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cleanup, fireEvent, render, renderHook, within } from '@testing-library/react-native';
import { useAppTheme } from '../contexts';
import { Choice, Disclosure, LinkRow, Row, Rows, SwitchRow } from './Ledger';

afterEach(async () => {
  await cleanup();
});

function Harness({ name = 'Synthetic entry', opened = false }: { name?: string; opened?: boolean }) {
  const [open, setOpen] = useState(opened);
  return (
    <Disclosure open={open} onToggle={() => setOpen(!open)} summary={<Text>{name}</Text>}>
      <Text>{`${name} detail`}</Text>
    </Disclosure>
  );
}

it('is a button marked collapsed that holds its detail only while open, directly under it', async () => {
  const view = await render(<Harness />);
  const toggle = view.getByRole('button', { name: 'Synthetic entry' });
  const [button, detail] = toggle.parent!.children as (typeof toggle)[];
  expect(button).toBe(toggle);
  expect(toggle).toBeCollapsed();
  expect(detail.children).toHaveLength(0);
  expect(view.queryByText('Synthetic entry detail')).toBeNull();

  await fireEvent.press(toggle);
  expect(toggle).toBeExpanded();
  expect(within(detail).getByText('Synthetic entry detail')).toBeTruthy();

  await fireEvent.press(toggle);
  expect(toggle).toBeCollapsed();
  expect(view.queryByText('Synthetic entry detail')).toBeNull();
});

it('puts its caret on the first line of the summary and indents the open detail past it', async () => {
  const view = await render(<Harness opened />);
  const toggle = view.getByRole('button', { name: 'Synthetic entry' });
  const [, detail] = toggle.parent!.children as (typeof toggle)[];
  expect(toggle).toHaveStyle({ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 16 });
  const [caret, summary] = toggle.children as (typeof toggle)[];
  expect(summary).toBe(view.getByText('Synthetic entry').parent);
  expect(caret).toHaveStyle({ height: 21, justifyContent: 'center' });
  expect(detail).toHaveStyle({ paddingLeft: 28, paddingBottom: 16 });
});

it('pads its detail only while open, so a closed row adds no space under its button', async () => {
  const view = await render(<Harness />);
  const toggle = view.getByRole('button', { name: 'Synthetic entry' });
  const [, detail] = toggle.parent!.children as (typeof toggle)[];
  expect(detail).not.toHaveStyle({ paddingBottom: 16 });
  expect(detail).not.toHaveStyle({ paddingLeft: 28 });
  await fireEvent.press(toggle);
  expect(detail).toHaveStyle({ paddingLeft: 28, paddingBottom: 16 });
  await fireEvent.press(toggle);
  expect(detail).not.toHaveStyle({ paddingBottom: 16 });
  expect(detail).not.toHaveStyle({ paddingLeft: 28 });
});

it('turns its caret a quarter to point at the open detail, and back when it closes', async () => {
  const view = await render(<Harness />);
  const toggle = view.getByRole('button', { name: 'Synthetic entry' });
  const caret = (toggle.children as (typeof toggle)[])[0];
  expect(caret).not.toHaveStyle({ transform: [{ rotate: '90deg' }] });
  await fireEvent.press(toggle);
  expect(caret).toHaveStyle({ transform: [{ rotate: '90deg' }] });
  await fireEvent.press(toggle);
  expect(caret).not.toHaveStyle({ transform: [{ rotate: '90deg' }] });
});

it('opens each disclosure on its own and hands its button to a ref', async () => {
  const ref = createRef<View>();
  const view = await render(
    <>
      <Disclosure ref={ref} open onToggle={() => {}} accessibilityLabel="First entry" summary={<Text>One</Text>}>
        <Text>First detail</Text>
      </Disclosure>
      <Harness name="Second entry" />
    </>,
  );
  expect(view.getByRole('button', { name: 'First entry' })).toBeExpanded();
  expect(view.getByText('First detail')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Second entry' })).toBeCollapsed();
  expect(view.queryByText('Second entry detail')).toBeNull();
  expect((ref.current as unknown as { props: Record<string, unknown> }).props).toMatchObject({
    accessibilityRole: 'button',
    accessibilityLabel: 'First entry',
  });
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

it('exposes explicit declaration acceptance as a checked and disabled checkbox', async () => {
  const accept = jest.fn();
  const view = await render(
    <Choice label="Accept declaration" accessibilityRole="checkbox" selected={false} onPress={accept} />,
  );
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept declaration', checked: false }));
  expect(accept).toHaveBeenCalledTimes(1);
  await view.rerender(
    <Choice label="Accept declaration" accessibilityRole="checkbox" selected onPress={accept} disabled />,
  );
  expect(view.getByRole('checkbox', { name: 'Accept declaration', checked: true })).toBeDisabled();
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
