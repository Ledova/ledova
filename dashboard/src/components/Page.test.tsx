// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { Page, PageAction } from './Page';
import { PageTitle } from './PageTitle';

afterEach(cleanup);

function titled(title: string, page: React.ReactNode) {
  return render(<PageTitle.Provider value={title}>{page}</PageTitle.Provider>);
}

it('heads the page with the title its route hands it, above its actions and content', () => {
  const filter = vi.fn();
  titled(
    'Wallets',
    <Page actions={<PageAction icon={null} label="Filter" onClick={filter} />}>
      <p>The wallet list</p>
    </Page>,
  );

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wallets');
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  expect(filter).toHaveBeenCalledOnce();
  expect(screen.getByText('The wallet list')).toBeTruthy();
});

it('keeps the title while loading, and shows a loading status instead of the content', () => {
  titled(
    'Dividends',
    <Page loading>
      <p>The dividend list</p>
    </Page>,
  );

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dividends');
  expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  expect(screen.queryByText('The dividend list')).toBeNull();
});
