// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { SwitchRow } from './Ledger';

afterEach(cleanup);

it('names the switch after its label, describes it with its sentence and shows the saved value', () => {
  const { rerender } = render(
    <SwitchRow
      label="Transaction alerts"
      description="Notifications for transaction status changes."
      checked
      onChange={vi.fn()}
    />,
  );
  const control = screen.getByRole('switch', {
    name: 'Transaction alerts',
    description: 'Notifications for transaction status changes.',
  });
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(control.textContent).toBe('On');

  rerender(<SwitchRow label="Transaction alerts" checked={false} onChange={vi.fn()} />);
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(control.textContent).toBe('Off');
  expect(control.hasAttribute('aria-describedby')).toBe(false);
});

it('asks for the other value when pressed, and for nothing while it is disabled', () => {
  const change = vi.fn();
  const { rerender } = render(<SwitchRow label="Directory" checked={false} onChange={change} />);
  const control = screen.getByRole('switch', { name: 'Directory' });
  fireEvent.click(control);
  expect(change).toHaveBeenLastCalledWith(true);

  rerender(<SwitchRow label="Directory" checked onChange={change} />);
  fireEvent.click(control);
  expect(change).toHaveBeenLastCalledWith(false);

  rerender(<SwitchRow label="Directory" checked onChange={change} disabled />);
  fireEvent.click(control);
  expect(change).toHaveBeenCalledTimes(2);
});
