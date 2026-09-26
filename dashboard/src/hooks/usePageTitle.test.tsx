// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { usePageTitle } from './usePageTitle';

afterEach(cleanup);

function titleAt(path: string) {
  const wrapper = ({ children }: PropsWithChildren) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  return renderHook(() => usePageTitle(), { wrapper }).result.current;
}

it.each([
  ['/directory', 'Directory'],
  ['/directory/7f1c2a9e', 'Directory'],
  ['/subscriptions', 'Subscriptions'],
  ['/subscriptions/7f1c2a9e', 'Subscription'],
  ['/publications', 'Publications'],
  ['/dividends', 'Dividends'],
  ['/company/offering', 'Offering'],
])('names %s instead of falling back to the product name', (path, title) => {
  expect(titleAt(path).title).toBe(title);
});

it('keeps each page subtitle with its title', () => {
  expect(titleAt('/wallets')).toEqual({
    path: '/wallets',
    title: 'Wallets',
    subtitle: 'Manage your digital asset wallets',
    audience: 'everyone',
  });
});

it('falls back to the product name for an address that is not a page', () => {
  expect(titleAt('/no-such-page')).toEqual({ title: 'Ledova' });
});
