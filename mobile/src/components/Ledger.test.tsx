import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { SwitchRow } from './Ledger';

afterEach(async () => {
  await cleanup();
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
