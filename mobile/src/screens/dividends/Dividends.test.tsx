import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_COPY } from '@ledova/shared';
import { DividendsScreen } from './index';

const dividend = {
  uuid: 'publication-d',
  kind: 'distribution',
  title: 'Final dividend 2026',
  companyName: 'Synthetic Holdings Pty Ltd',
  tokenName: 'Synthetic ordinary shares',
  tokenSymbol: 'SYN',
  recordDate: '2026-09-20',
  shares: '1250',
  createdAt: '2026-09-21T02:00:00Z',
  question: null,
  resolutionKind: null,
  opensAt: null,
  closesAt: null,
  myBallot: null,
  result: null,
  ratePerShare: '0.025000',
  currency: 'AUD',
  declaredOn: '2026-09-13',
  paymentDate: '2026-10-03',
  myEntitlement: '31.25',
  myPaymentRecord: null,
};

const earlier = { ...dividend, uuid: 'publication-e', title: 'Interim dividend 2026' };

const recorded = { recordedPaidOn: '2026-10-03', reference: 'LDV-4412', recordedAt: '2026-10-03T04:00:00Z' };

const get = jest.fn();
const apiClient = { get } as unknown as AxiosInstance;

let client: QueryClient;
let pages: Record<number, unknown[]>;
let failing: boolean;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  pages = { 1: [dividend] };
  failing = false;
  get.mockImplementation(async (_url: string, config?: AxiosRequestConfig) => {
    if (failing) throw new Error('unavailable');
    const page = config?.params?.page ?? 1;
    return {
      data: {
        count: Object.values(pages).flat().length,
        next: pages[page + 1] ? `https://api.example/api/v1/publications/?kind=distribution&page=${page + 1}` : null,
        previous: null,
        results: pages[page] ?? [],
      },
    };
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('asks for distributions alone and shows the company, the class, the rate, the holding and the entitlement', async () => {
  const view = await render(<DividendsScreen />, { wrapper });

  expect(await view.findByText('Final dividend 2026')).toBeTruthy();
  expect(view.getByText('Synthetic Holdings Pty Ltd · Synthetic ordinary shares (SYN)')).toBeTruthy();
  expect(view.getByText(`${PUBLICATION_COPY.RATE_LABEL}: AUD 0.025 per share`)).toBeTruthy();
  expect(view.getByText(`1,250 · ${PUBLICATION_COPY.HOLDING_LABEL}`)).toBeTruthy();
  expect(view.getByText(`${PUBLICATION_COPY.ENTITLEMENT_LABEL}: AUD 31.25`)).toBeTruthy();
  expect(view.getByText(`${PUBLICATION_COPY.PAYMENT_DATE_LABEL}: 3 October 2026`)).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.DIVIDENDS_APART)).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/api/v1/publications/', { params: { page: 1, kind: 'distribution' } });
});

it('says the company recorded the payment, when and under what reference, and never that it was paid', async () => {
  pages = { 1: [{ ...dividend, myPaymentRecord: recorded }] };

  const view = await render(<DividendsScreen />, { wrapper });

  expect(
    await view.findByText('The company recorded this as paid on 3 October 2026, reference LDV-4412.'),
  ).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.RECORDS_ONLY)).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
});

it('reads earlier dividends a page at a time', async () => {
  pages = { 1: [dividend], 2: [earlier] };

  const view = await render(<DividendsScreen />, { wrapper });
  await fireEvent.press(await view.findByText(PUBLICATION_COPY.DIVIDENDS_LOAD_MORE));

  expect(await view.findByText('Interim dividend 2026')).toBeTruthy();
  expect(get).toHaveBeenLastCalledWith('/api/v1/publications/', { params: { page: 2, kind: 'distribution' } });
  expect(view.queryByText(PUBLICATION_COPY.DIVIDENDS_LOAD_MORE)).toBeNull();
});

it('says so when no dividend has been declared to the member', async () => {
  pages = { 1: [] };

  const view = await render(<DividendsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.DIVIDENDS_EMPTY_TITLE)).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
});

it('says the dividends could not be loaded, and loads them on a retry', async () => {
  failing = true;

  const view = await render(<DividendsScreen />, { wrapper });
  const retry = await view.findByText(PUBLICATION_COPY.RETRY);
  expect(view.getByText(PUBLICATION_COPY.DIVIDENDS_LIST_FAILED)).toBeTruthy();
  failing = false;
  await fireEvent.press(retry);

  expect(await view.findByText('Final dividend 2026')).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.DIVIDENDS_LIST_FAILED)).toBeNull();
});
