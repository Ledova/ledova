// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@components/NotificationBell', () => ({
  NotificationBell: ({ align }: { align: string }) => <span data-testid="bell" data-align={align} />,
}));
vi.mock('@components/Sidebar', () => ({ Sidebar: () => null }));

import { MobileHeader } from '.';

afterEach(cleanup);

function Elsewhere() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/wallets')}>Go elsewhere</button>;
}

function drawerIsOpen() {
  return screen.getByRole('button', { name: 'Close navigation' }).parentElement!.classList.contains('translate-x-0');
}

it('closes the open drawer when the route changes without the drawer being used', () => {
  render(
    <MemoryRouter initialEntries={['/home']}>
      <MobileHeader />
      <Elsewhere />
    </MemoryRouter>,
  );
  expect(drawerIsOpen()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(drawerIsOpen()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));
  expect(drawerIsOpen()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(drawerIsOpen()).toBe(true);
});

it('keeps the bell in the phone bar, at its far end, rather than in the drawer', () => {
  render(
    <MemoryRouter initialEntries={['/home']}>
      <MobileHeader />
    </MemoryRouter>,
  );

  const bar = screen.getByRole('button', { name: 'Open navigation' }).parentElement!;
  expect(screen.getAllByTestId('bell')).toHaveLength(1);
  expect(bar.contains(screen.getByTestId('bell'))).toBe(true);
  expect(screen.getByTestId('bell').dataset.align).toBe('end');
});
