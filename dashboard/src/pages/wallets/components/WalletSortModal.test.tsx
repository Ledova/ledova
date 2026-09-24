// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WalletSortOption } from '../hooks/useWalletSort';
import { WalletSortModal } from './WalletSortModal';

afterEach(cleanup);

function Harness({ applied }: { applied: (sort: WalletSortOption) => void }) {
  const [open, setOpen] = useState(true);
  const [sort, setSort] = useState<WalletSortOption>('default');
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sort</button>
      <WalletSortModal
        isOpen={open}
        selectedSort={sort}
        onClose={() => setOpen(false)}
        onApply={(next) => {
          applied(next);
          setSort(next);
        }}
      />
    </>
  );
}

function chosen(label: string) {
  return screen.getByText(label).classList.contains('text-brand-light');
}

it('opens on the applied sort and discards a choice that was closed without applying', () => {
  const applied = vi.fn();
  render(<Harness applied={applied} />);
  expect(chosen('Default')).toBe(true);
  fireEvent.click(screen.getByText('Alphabetical'));
  expect(chosen('Alphabetical')).toBe(true);
  fireEvent.click(screen.getByText('Close'));
  fireEvent.click(screen.getByText('Open sort'));
  expect(chosen('Default')).toBe(true);
  expect(chosen('Alphabetical')).toBe(false);

  fireEvent.click(screen.getByText('Highest Value'));
  fireEvent.click(screen.getByText('Apply'));
  expect(applied).toHaveBeenCalledExactlyOnceWith('highestValue');
  fireEvent.click(screen.getByText('Open sort'));
  expect(chosen('Highest Value')).toBe(true);
});
