// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { Section } from './Ledger';
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

it.each([
  ['with a lede', 'Select an entry for its status and details.'],
  ['without a lede', undefined],
])('keeps the title block whole %s, so the first section follows it at the page gap', (_, lede) => {
  titled(
    'Activity',
    <Page lede={lede} actions={<PageAction label="Filter" onClick={() => {}} />}>
      <Section title="Transfers">
        <p>No activity yet.</p>
      </Section>
    </Page>,
  );

  const heading = screen.getByRole('heading', { level: 1, description: lede ?? '' });
  const block = heading.closest('header')!;
  expect(block.contains(screen.getByRole('button', { name: 'Filter' }))).toBe(true);
  if (lede) expect(block.contains(screen.getByText(lede))).toBe(true);
  expect(block.nextElementSibling).toBe(
    screen.getByRole('heading', { level: 2, name: 'Transfers' }).closest('section'),
  );
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
