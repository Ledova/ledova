// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Disclosure, SwitchRow } from './Ledger';

afterEach(cleanup);

function Harness({ opened = false, region }: { opened?: boolean; region?: boolean }) {
  const [open, setOpen] = useState(opened);
  return (
    <Disclosure open={open} onToggle={() => setOpen(!open)} region={region} summary="Synthetic entry">
      <p>Synthetic detail</p>
    </Disclosure>
  );
}

const controlledBy = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-controls')!)!;

it('is a button with aria-expanded controlling the detail under it, which it holds only while open', () => {
  render(<Harness />);
  const button = screen.getByRole('button', { name: 'Synthetic entry' });
  const detail = controlledBy(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(detail.hidden).toBe(true);
  expect(detail.textContent).toBe('');

  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(detail.hidden).toBe(false);
  expect(within(detail).getByText('Synthetic detail')).toBeTruthy();
  expect(button.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Synthetic detail')).toBeNull();
});

it('is no landmark unless asked, and then a region labelled by its button', () => {
  const view = render(<Harness opened />);
  expect(controlledBy(screen.getByRole('button', { name: 'Synthetic entry' })).hidden).toBe(false);
  expect(screen.queryByRole('region')).toBeNull();
  view.unmount();

  render(<Harness opened region />);
  const button = screen.getByRole('button', { name: 'Synthetic entry' });
  const region = screen.getByRole('region', { name: 'Synthetic entry' });
  expect(region).toBe(controlledBy(button));
  expect(region.getAttribute('aria-labelledby')).toBe(button.id);
});

it('gives each disclosure its own detail and hands its button to a ref', () => {
  const ref = createRef<HTMLButtonElement>();
  render(
    <>
      <Disclosure ref={ref} open onToggle={() => {}} summary="First entry">
        <p>First detail</p>
      </Disclosure>
      <Harness opened />
    </>,
  );
  const first = screen.getByRole('button', { name: 'First entry' });
  const second = screen.getByRole('button', { name: 'Synthetic entry' });
  expect(first.getAttribute('aria-controls')).not.toBe(second.getAttribute('aria-controls'));
  expect(within(controlledBy(first)).getByText('First detail')).toBeTruthy();
  expect(within(controlledBy(second)).getByText('Synthetic detail')).toBeTruthy();
  expect(ref.current).toBe(first);
});

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
