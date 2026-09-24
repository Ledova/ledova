// @vitest-environment jsdom
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_COPY } from '@ledova/shared';
import DividendsPage from './index';

const get = vi.fn();
const apiClient = { get } as unknown as AxiosInstance;

const dividend = {
  uuid: 'a1b2c3d4-0000-4000-8000-000000000011',
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
  myRecordedEntitlement: '0.00',
};

const earlier = { ...dividend, uuid: 'a1b2c3d4-0000-4000-8000-000000000012', title: 'Interim dividend 2026' };

const recorded = { recordedPaidOn: '2026-10-03', reference: 'LDV-4412', recordedAt: '2026-10-03T04:00:00Z' };

let client: QueryClient;
let pages: Record<number, unknown[]>;
let failing: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

afterEach(() => {
  cleanup();
  client.clear();
});

function showPage() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <DividendsPage />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('the dividends a member was declared, beside their transactions', () => {
  it('asks for the dividends owed to the member alone and shows the company, the class, the rate, the holding and the entitlement', async () => {
    showPage();

    expect(await screen.findByText('Final dividend 2026')).toBeTruthy();
    expect(screen.getByText(/Synthetic Holdings Pty Ltd/)).toBeTruthy();
    expect(screen.getByText(/Synthetic ordinary shares/)).toBeTruthy();
    expect(screen.getByText('AUD 0.025 per share')).toBeTruthy();
    expect(screen.getByText('1,250')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.HOLDING_LABEL)).toBeTruthy();
    expect(screen.getByText('AUD 31.25')).toBeTruthy();
    expect(screen.getByText('3 October 2026')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.DIVIDENDS_APART)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/v1/publications/', {
      params: { page: 1, kind: 'distribution', addressed: 'me' },
    });
  });

  it('says the company recorded the payment, when and under what reference, and never that it was paid', async () => {
    pages = { 1: [{ ...dividend, myPaymentRecord: recorded, myRecordedEntitlement: dividend.myEntitlement }] };

    showPage();

    expect(
      await screen.findByText('The company recorded this as paid on 3 October 2026, reference LDV-4412.'),
    ).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.RECORDS_ONLY)).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
  });

  it('reads earlier dividends a page at a time', async () => {
    pages = { 1: [dividend], 2: [earlier] };

    showPage();
    fireEvent.click(await screen.findByText(PUBLICATION_COPY.DIVIDENDS_LOAD_MORE));

    expect(await screen.findByText('Interim dividend 2026')).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith('/api/v1/publications/', {
      params: { page: 2, kind: 'distribution', addressed: 'me' },
    });
    await waitFor(() => expect(screen.queryByText(PUBLICATION_COPY.DIVIDENDS_LOAD_MORE)).toBeNull());
  });

  it('says so when no dividend has been declared to the member', async () => {
    pages = { 1: [] };

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.DIVIDENDS_EMPTY_TITLE)).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
  });

  it('says the dividends could not be loaded, and loads them on a retry', async () => {
    failing = true;

    showPage();
    const retry = await screen.findByText(PUBLICATION_COPY.RETRY);
    expect(screen.getByRole('alert').textContent).toContain(PUBLICATION_COPY.DIVIDENDS_LIST_FAILED);
    failing = false;
    fireEvent.click(retry);

    expect(await screen.findByText('Final dividend 2026')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
