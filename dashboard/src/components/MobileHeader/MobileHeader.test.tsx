// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@components/NotificationBell', () => ({ NotificationBell: () => null }));
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
