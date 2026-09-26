// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const operator = vi.hoisted(() => ({ name: 'Example Operator' }));
const resolved = (results: unknown[]) => () => Promise.resolve({ data: { results } });

vi.mock('@ledova/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ledova/shared');
  return {
    ...actual,
    getOfferings: resolved([]),
    getCompanyTokens: resolved([]),
    getOperator: () => Promise.resolve({ data: { name: operator.name, supportedSettlementAssets: [] } }),
  };
});

const { useOfferings } = await import('./useOffering');

function Probe() {
  const { operatorName, isLoading } = useOfferings();
  return <span>{isLoading ? 'loading' : `named: ${operatorName}`}</span>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

it('names the operator from its record', async () => {
  operator.name = 'Example Operator';
  mount();

  expect(await screen.findByText('named: Example Operator')).toBeDefined();
});

it('says the operator when the record carries no name', async () => {
  operator.name = '';
  mount();

  expect(await screen.findByText('named: the operator')).toBeDefined();
});
