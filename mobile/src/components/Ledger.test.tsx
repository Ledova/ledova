import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { Choice, LinkRow, Row, Rows } from './Ledger';

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
