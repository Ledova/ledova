import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { PUBLICATION_COPY } from '@ledova/shared';
import { TransactionsScreen } from './index';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn() }),
}));
jest.mock('./useTransactions', () => ({
  useTransactions: () => ({
    transactions: [],
    ethWallets: [],
    btcWallets: [],
    baseWallets: [],
    isLoading: false,
    filters: {},
    hasActiveFilters: false,
    totalCount: 0,
    loadMore: jest.fn(),
    updateFilters: jest.fn(),
    updateAndApplyFilters: jest.fn(),
    clearFilters: jest.fn(),
  }),
}));

afterEach(async () => {
  await cleanup();
});

it('links to the dividends, which are listed beside the transactions and not among them', async () => {
  const view = await render(<TransactionsScreen />);

  await fireEvent.press(view.getByText(PUBLICATION_COPY.DIVIDENDS_OPEN));

  expect(mockNavigate).toHaveBeenCalledWith('Dividends');
});
