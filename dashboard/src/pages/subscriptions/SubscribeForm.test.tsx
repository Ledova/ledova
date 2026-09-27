// @vitest-environment jsdom

import { useState, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { DirectoryOpenOffering, Wallet } from '@ledova/shared';
import { SubscribeForm } from './SubscribeForm';

function DraftForm(props: Omit<ComponentProps<typeof SubscribeForm>, 'draft' | 'onDraftChange'>) {
  const [draft, setDraft] = useState<{ quantity: string; wallet: string | null }>({ quantity: '', wallet: null });
  return <SubscribeForm {...props} draft={draft} onDraftChange={setDraft} />;
}

const offering: DirectoryOpenOffering = {
  uuid: 'offering',
  opensAt: '2026-09-01T00:00:00Z',
  closesAt: null,
  pricePerShare: '90071992547409.93',
  priceCurrency: 'AUD',
};
const primary = { uuid: 'primary', name: 'Primary', address: '0x1111111111111111111111111111111111111111' } as Wallet;
const reserve = { uuid: 'reserve', name: 'Reserve', address: '0x2222222222222222222222222222222222222222' } as Wallet;
afterEach(cleanup);

it('computes the payable total with exact cents, including beyond floating-point precision', () => {
  const onSubscribe = vi.fn();
  render(
    <MemoryRouter>
      <DraftForm offering={offering} wallets={[primary]} busy={false} error={null} onSubscribe={onSubscribe} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '3' } });
  expect(screen.getByText(/AUD\s270,215,977,642,229.79/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }));
  expect(onSubscribe).toHaveBeenCalledExactlyOnceWith({ wallet: 'primary', quantity: 3 });
});

it.each(['', '0', '-1', '1.5', '3e2', '9007199254740993', 'Infinity', 'text'])(
  'refuses a non-whole or unsafe quantity %s',
  (quantity) => {
    const onSubscribe = vi.fn();
    render(
      <MemoryRouter>
        <DraftForm offering={offering} wallets={[primary]} busy={false} error={null} onSubscribe={onSubscribe} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: quantity } });
    const button = screen.getByRole('button', { name: 'Create application' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubscribe).not.toHaveBeenCalled();
  },
);

it('requires an explicit replacement when a selected wallet disappears during refresh', () => {
  const onSubscribe = vi.fn();
  const renderForm = (wallets: Wallet[]) => (
    <MemoryRouter>
      <DraftForm offering={offering} wallets={wallets} busy={false} error={null} onSubscribe={onSubscribe} />
    </MemoryRouter>
  );
  const view = render(renderForm([primary, reserve]));
  fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Receiving wallet (Base)'), { target: { value: 'reserve' } });
  view.rerender(renderForm([primary]));
  expect((screen.getByRole('button', { name: 'Create application' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Receiving wallet (Base)') as HTMLSelectElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Receiving wallet (Base)'), { target: { value: 'primary' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }));
  expect(onSubscribe).toHaveBeenCalledExactlyOnceWith({ wallet: 'primary', quantity: 2 });
});

it('prevents a second draft request while the first one is pending', () => {
  const onSubscribe = vi.fn();
  render(
    <MemoryRouter>
      <DraftForm offering={offering} wallets={[primary]} busy error={null} onSubscribe={onSubscribe} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '2' } });
  const button = screen.getByRole('button', { name: 'Creating draft…' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(onSubscribe).not.toHaveBeenCalled();
});
