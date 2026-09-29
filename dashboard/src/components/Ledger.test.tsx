// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Disclosure } from './Ledger';

afterEach(cleanup);

function Harness({ opened = false }: { opened?: boolean }) {
  const [open, setOpen] = useState(opened);
  return (
    <Disclosure open={open} onToggle={() => setOpen(!open)} summary="Synthetic entry">
      <p>Synthetic detail</p>
    </Disclosure>
  );
}

it('is a button with aria-expanded controlling the region under it, which holds the detail only while open', () => {
  render(<Harness />);
  const button = screen.getByRole('button', { name: 'Synthetic entry' });
  const controlled = document.getElementById(button.getAttribute('aria-controls')!)!;
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(controlled.hidden).toBe(true);
  expect(controlled.textContent).toBe('');
  expect(screen.queryByRole('region')).toBeNull();

  fireEvent.click(button);
  const region = screen.getByRole('region', { name: 'Synthetic entry' });
  expect(region).toBe(controlled);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(region.getAttribute('aria-labelledby')).toBe(button.id);
  expect(within(region).getByText('Synthetic detail')).toBeTruthy();
  expect(button.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Synthetic detail')).toBeNull();
});

it('gives each disclosure its own region and hands its button to a ref', () => {
  const ref = createRef<HTMLButtonElement>();
  render(
    <>
      <Disclosure ref={ref} open onToggle={() => {}} summary="First entry">
        <p>First detail</p>
      </Disclosure>
      <Harness opened />
    </>,
  );
  const [first, second] = screen.getAllByRole('region');
  expect(first.id).not.toBe(second.id);
  expect(ref.current).toBe(screen.getByRole('button', { name: 'First entry' }));
});
