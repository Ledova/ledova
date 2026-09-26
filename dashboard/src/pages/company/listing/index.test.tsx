// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DESTINATIONS } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../hooks/useCompany', () => ({
  useCompany: () => ({ company: null, companyUuid: undefined, isLoading: false }),
}));
vi.mock('@services/apiClient', () => ({ default: {} }));

import ListingPage from './index';

afterEach(cleanup);

it('keeps the page title when there is no company to show', () => {
  render(
    <PageTitle.Provider value={DESTINATIONS.companyListing.title}>
      <ListingPage />
    </PageTitle.Provider>,
  );

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS.companyListing.title);
  expect(screen.getByText(/No company found/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Go to Company' })).toBeTruthy();
});
