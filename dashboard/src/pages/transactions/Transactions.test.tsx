// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PUBLICATION_COPY } from '@ledova/shared';
import TransactionsPage from './index';

vi.mock('./useTransactions', () => ({
  useTransactions: () => ({
    transactions: [],
    wallets: [],
    isLoading: false,
    isLoadingMore: false,
    filters: {},
    hasActiveFilters: false,
    totalCount: 0,
    hasNextPage: false,
    applyFilters: vi.fn(),
    updateFilters: vi.fn(),
    clearFilters: vi.fn(),
    loadMore: vi.fn(),
  }),
}));

afterEach(cleanup);

it('links to the dividends, which are listed beside the transactions and not among them', async () => {
  render(
    <MemoryRouter initialEntries={['/transactions']}>
      <Routes>
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/dividends" element={<p>The dividends page</p>} />
      </Routes>
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByText(PUBLICATION_COPY.DIVIDENDS_OPEN));

  expect(await screen.findByText('The dividends page')).toBeTruthy();
});
