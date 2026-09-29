// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

function Harness({ onConfirm, fullHeight = false }: { onConfirm: () => void; fullHeight?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Change password"
        showFooter
        confirmLabel="Change password"
        onConfirm={onConfirm}
        fullHeight={fullHeight}
      >
        <label>
          Current password
          <input />
        </label>
      </Modal>
    </>
  );
}

it('is a card labelled by its title that ends with Cancel then the primary action, right-aligned at content width', async () => {
  const confirm = vi.fn();
  render(<Harness onConfirm={confirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

  const dialog = await screen.findByRole('dialog', { name: 'Change password' });
  expect(within(dialog).getByRole('heading', { level: 2, name: 'Change password' })).toBeTruthy();
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  const primary = within(dialog).getByRole('button', { name: 'Change password' });
  const row = cancel.parentElement!;
  expect(Array.from(row.children)).toEqual([cancel, primary]);
  expect(row.className).toContain('justify-end');
  for (const action of [cancel, primary]) {
    expect(action.className).toMatch(/\bw-fit\b/);
    expect(action.className).not.toMatch(/\b(w-full|flex-1)\b/);
  }
  expect(primary.className).toContain('bg-brand-mid');
  expect(cancel.className).not.toContain('bg-brand-mid');

  fireEvent.click(primary);
  expect(confirm).toHaveBeenCalledOnce();
  fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('scrolls a tall body inside the card and lets a full-height body grow', async () => {
  const view = render(<Harness onConfirm={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
  const body = (await screen.findByLabelText('Current password')).closest('label')!.parentElement!;
  expect(body.className).toContain('overflow-y-auto');
  expect(body.className).toContain('max-h-[70vh]');
  view.unmount();

  render(<Harness onConfirm={vi.fn()} fullHeight />);
  fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
  const tall = (await screen.findByLabelText('Current password')).closest('label')!.parentElement!;
  expect(tall.className).not.toContain('max-h-[70vh]');
});

it('takes focus, closes on Escape and returns focus to what opened it', async () => {
  render(<Harness onConfirm={vi.fn()} />);
  const opener = screen.getByRole('button', { name: 'Open dialog' });
  opener.focus();
  fireEvent.click(opener);

  const dialog = await screen.findByRole('dialog', { name: 'Change password' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('holds both actions while the primary action is loading', () => {
  const confirm = vi.fn();
  render(
    <Modal
      isOpen
      onClose={vi.fn()}
      title="Delete account"
      showFooter
      confirmLabel="Delete account"
      onConfirm={confirm}
      confirmLoading
    >
      <p>This action cannot be undone.</p>
    </Modal>,
  );

  const primary = screen.getByRole('button', { name: 'Loading...' }) as HTMLButtonElement;
  expect(primary.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(primary);
  expect(confirm).not.toHaveBeenCalled();
});
