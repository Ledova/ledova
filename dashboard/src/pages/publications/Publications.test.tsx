// @vitest-environment jsdom
import type { AxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { PUBLICATION_COPY, createUserFriendlyError, formatDateTime } from '@ledova/shared';
import PublicationsPage from './index';

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const statement = {
  uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
  kind: 'holding_statement',
  title: 'Annual holding statement 2026',
  companyName: 'Synthetic Holdings Pty Ltd',
  tokenName: 'Synthetic ordinary shares',
  tokenSymbol: 'SYN',
  recordDate: '2026-09-20',
  shares: '100',
  createdAt: '2026-09-21T02:00:00Z',
  question: null,
  resolutionKind: null,
  opensAt: null,
  closesAt: null,
  myBallot: null,
  ballotOutstanding: false,
  result: null,
  ratePerShare: null,
  currency: null,
  declaredOn: null,
  paymentDate: null,
  myEntitlement: null,
  myRecordedEntitlement: null,
  myPaymentRecord: null,
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const fromNow = (offset: number) => new Date(Date.now() + offset).toISOString();

const resolution = {
  ...statement,
  uuid: 'a1b2c3d4-0000-4000-8000-000000000009',
  kind: 'resolution',
  title: 'Resolution to adopt a constitution',
  question: 'That the company adopt the synthetic constitution tabled with this notice.',
  resolutionKind: 'special',
  opensAt: fromNow(-HOUR),
  closesAt: fromNow(7 * 24 * HOUR),
  ballotOutstanding: true,
};

const tally = {
  for: { shares: '100', members: 1 },
  against: { shares: '40', members: 1 },
  abstain: { shares: '0', members: 0 },
  eligible: { shares: '150', members: 3 },
  carried: true,
};

const closed = { opensAt: fromNow(-48 * HOUR), closesAt: fromNow(-24 * HOUR) };

const dividend = {
  ...statement,
  uuid: 'a1b2c3d4-0000-4000-8000-000000000011',
  kind: 'distribution',
  title: 'Final dividend 2026',
  ratePerShare: '0.025000',
  currency: 'AUD',
  declaredOn: '2026-09-13',
  paymentDate: '2026-10-03',
  myEntitlement: '2.50',
  myRecordedEntitlement: '0.00',
  myPaymentRecord: null,
};

const recorded = { recordedPaidOn: '2026-10-03', reference: 'LDV-4412', recordedAt: '2026-10-03T04:00:00Z' };

let client: QueryClient;
let rows: unknown[];
let file: () => Promise<{ data: Blob }>;
let listing: (page: number, addressed?: string) => Promise<unknown>;
let ownedOnly: unknown[];
let saved: { href: string | null; download: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [statement];
  ownedOnly = [];
  file = async () => ({ data: new Blob(['stored bytes'], { type: 'application/pdf' }) });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  listing = async (page, addressed) => ({
    data: {
      count: rows.length,
      next: null,
      previous: null,
      results: page === 1 ? [...rows, ...(addressed === 'me' ? [] : ownedOnly)] : [],
    },
  });
  vi.mocked(apiClient.get).mockImplementation(async (url: string, config?: AxiosRequestConfig) => {
    if (url === '/api/v1/publications/') return listing(config?.params?.page ?? 1, config?.params?.addressed);
    return file();
  });
  window.open = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:a-private-copy');
  URL.revokeObjectURL = vi.fn();
  saved = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.getAttribute('href'), download: this.download });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
  client.clear();
});

function showPage() {
  return render(
    <QueryClientProvider client={client}>
      <PublicationsPage />
    </QueryClientProvider>,
  );
}

describe('the publications a shareholder has been sent', () => {
  it('lists the kind, the title, the company, the share class, the record date and the frozen holding', async () => {
    showPage();

    expect(await screen.findByText('Annual holding statement 2026')).toBeTruthy();
    expect(screen.getByText('Annual holding statement')).toBeTruthy();
    expect(screen.getByText(/Synthetic Holdings Pty Ltd/)).toBeTruthy();
    expect(screen.getByText(/Synthetic ordinary shares/)).toBeTruthy();
    expect(screen.getByText(/20 September 2026/)).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.HOLDING_LABEL)).toBeTruthy();
  });

  it('says so when nothing has been published, without offering a document to open', async () => {
    rows = [];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.EMPTY)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Your notices' })).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.OPEN)).toBeNull();
  });

  it('opens the stored document through the route that audits the read', async () => {
    showPage();

    fireEvent.click(await screen.findByText(PUBLICATION_COPY.OPEN));

    await waitFor(() =>
      expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith(`/api/v1/publications/${statement.uuid}/file/`, {
        responseType: 'blob',
      }),
    );
    await waitFor(() => expect(saved).toEqual([{ href: 'blob:a-private-copy', download: `${statement.uuid}.pdf` }]));
    expect(window.open).not.toHaveBeenCalled();
  });

  it('shows earlier publications a page at a time', async () => {
    const earlier = { ...statement, uuid: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Meeting notice 2025' };
    listing = async (page) =>
      page === 1
        ? { data: { count: 2, next: 'https://api.example/api/v1/publications/?page=2', previous: null, results: rows } }
        : { data: { count: 2, next: null, previous: null, results: [earlier] } };

    showPage();
    fireEvent.click(await screen.findByText(PUBLICATION_COPY.LOAD_MORE));

    expect(await screen.findByText('Meeting notice 2025')).toBeTruthy();
    expect(screen.getByText('Annual holding statement 2026')).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.LOAD_MORE)).toBeNull();
  });

  it('says the listing failed rather than that nothing was published, and offers to try again', async () => {
    let failing = true;
    listing = async () => {
      if (failing) throw { response: { status: 500 } };
      return { data: { count: 1, next: null, previous: null, results: rows } };
    };

    showPage();

    expect((await screen.findByRole('alert')).textContent).toContain(PUBLICATION_COPY.LIST_FAILED);
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByText(PUBLICATION_COPY.RETRY));
    expect(await screen.findByText('Annual holding statement 2026')).toBeTruthy();
  });

  it('says nothing was served when the read could not be recorded', async () => {
    file = () => Promise.reject({ response: { status: 503 } });

    showPage();
    fireEvent.click(await screen.findByText(PUBLICATION_COPY.OPEN));

    expect((await screen.findByRole('alert')).textContent).toBe(PUBLICATION_COPY.UNDELIVERABLE);
    expect(window.open).not.toHaveBeenCalled();
  });

  it.each([
    [503, PUBLICATION_COPY.UNDELIVERABLE],
    [500, PUBLICATION_COPY.FAILED],
    [undefined, PUBLICATION_COPY.FAILED],
  ])('retains download failure meaning when the API client wraps status %s', async (status, message) => {
    const original = status
      ? { response: { status, data: new Blob(['Unavailable'], { type: 'application/json' }) } }
      : new Error('Network Error');
    file = () => Promise.reject(createUserFriendlyError('Please try again.', original));

    showPage();
    fireEvent.click(await screen.findByText(PUBLICATION_COPY.OPEN));

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(saved).toEqual([]);
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('a resolution put to the members', () => {
  const ballotButtons = () => ['For', 'Against', 'Abstain'].map((name) => screen.queryByRole('button', { name }));

  it('shows the question, its kind and basis, its window, that it is open and the frozen holding as the votes', async () => {
    rows = [resolution];

    showPage();

    expect(await screen.findByText(resolution.question)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.QUESTION_LABEL)).toBeTruthy();
    expect(screen.getByText(`Special resolution · ${PUBLICATION_COPY.BASIS}`)).toBeTruthy();
    expect(
      screen.getByText(
        `${PUBLICATION_COPY.WINDOW_LABEL} ${formatDateTime(resolution.opensAt)} ${PUBLICATION_COPY.WINDOW_TO} ${formatDateTime(resolution.closesAt)}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText(`${PUBLICATION_COPY.OPEN_UNTIL} ${formatDateTime(resolution.closesAt)}`)).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.VOTING_WEIGHT_LABEL)).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.HOLDING_LABEL)).toBeNull();
    expect(ballotButtons().every(Boolean)).toBe(true);
  });

  it('says a resolution whose window has not opened is not open yet, and offers no ballot', async () => {
    rows = [{ ...resolution, opensAt: fromNow(HOUR), closesAt: fromNow(2 * HOUR) }];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.NOT_OPEN_YET)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
  });

  it('asks the member to confirm a ballot cannot be changed, and casts nothing when they cancel', async () => {
    rows = [resolution];

    showPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Against' }));

    expect(screen.getByText(`${PUBLICATION_COPY.CONFIRM_TITLE} Against`)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.CONFIRM_BODY)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.CANCEL }));
    expect(ballotButtons().every(Boolean)).toBe(true);
    expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
  });

  it('casts the confirmed ballot and then shows it from the refreshed listing', async () => {
    rows = [resolution];
    const voted = {
      ...resolution,
      myBallot: { choice: 'for', castAt: fromNow(0), staffEntered: false },
      ballotOutstanding: false,
    };
    vi.mocked(apiClient.post).mockImplementation(async () => {
      rows = [voted];
      return { data: voted };
    });

    showPage();
    fireEvent.click(await screen.findByRole('button', { name: 'For' }));
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.CONFIRM }));

    expect(await screen.findByText(PUBLICATION_COPY.YOU_VOTED.for)).toBeTruthy();
    expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
      `/api/v1/publications/${resolution.uuid}/ballot/`,
      { choice: 'for' },
      {},
    );
    expect(vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/api/v1/publications/').length).toBe(2);
    expect(ballotButtons().some(Boolean)).toBe(false);
    expect(screen.queryByText(PUBLICATION_COPY.STAFF_ENTERED)).toBeNull();
  });

  it('shows a ballot staff entered for the member as voted for them by staff', async () => {
    rows = [
      {
        ...resolution,
        myBallot: { choice: 'abstain', castAt: fromNow(0), staffEntered: true },
        ballotOutstanding: false,
      },
    ];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.YOU_VOTED.abstain)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.STAFF_ENTERED)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
  });

  it('shows the route refusal as its own message and keeps the ballot uncast', async () => {
    rows = [resolution];
    vi.mocked(apiClient.post).mockRejectedValue({
      response: { status: 400, data: ['Voting on this resolution has closed.'] },
    });

    showPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Abstain' }));
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.CONFIRM }));

    expect((await screen.findByRole('alert')).textContent).toBe('Voting on this resolution has closed.');
    expect(screen.queryByText(PUBLICATION_COPY.YOU_VOTED.abstain)).toBeNull();
  });

  it('shows the result once closed: whether it carried, each count, turnout against those eligible', async () => {
    rows = [
      {
        ...resolution,
        ...closed,
        myBallot: { choice: 'for', castAt: fromNow(-30 * HOUR), staffEntered: false },
        ballotOutstanding: false,
        result: tally,
      },
    ];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.CARRIED)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.CLOSED)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.YOU_VOTED.for)).toBeTruthy();
    expect(screen.getByText('100 shares · 1 member')).toBeTruthy();
    expect(screen.getByText('40 shares · 1 member')).toBeTruthy();
    expect(screen.getByText('0 shares · 0 members')).toBeTruthy();
    expect(screen.getByText('140 of 150 shares · 2 of 3 members')).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.NOT_CARRIED)).toBeNull();
    expect(ballotButtons().some(Boolean)).toBe(false);
  });

  it('says a resolution that did not carry did not carry', async () => {
    rows = [{ ...resolution, ...closed, result: { ...tally, carried: false } }];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.NOT_CARRIED)).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.CARRIED)).toBeNull();
  });

  it('says the result is still to be counted when the window has passed and no tally has arrived', async () => {
    rows = [{ ...resolution, ...closed }];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.RESULT_PENDING)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
  });

  it('offers the rest of a ballot when staff voted part of the holding, beside the part already voted', async () => {
    const partly = {
      ...resolution,
      shares: '140',
      myBallot: { choice: 'against', castAt: fromNow(0), staffEntered: true },
      ballotOutstanding: true,
    };
    rows = [partly];
    vi.mocked(apiClient.post).mockImplementation(async () => {
      rows = [{ ...partly, ballotOutstanding: false }];
      return { data: rows[0] };
    });

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.YOU_VOTED.against)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.STAFF_ENTERED)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.BALLOT_OUTSTANDING)).toBeTruthy();
    expect(ballotButtons().every(Boolean)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'For' }));
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.CONFIRM }));

    await waitFor(() => expect(screen.queryByText(PUBLICATION_COPY.BALLOT_OUTSTANDING)).toBeNull());
    expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
      `/api/v1/publications/${resolution.uuid}/ballot/`,
      { choice: 'for' },
      {},
    );
    expect(ballotButtons().some(Boolean)).toBe(false);
    expect(screen.getByText(PUBLICATION_COPY.YOU_VOTED.against)).toBeTruthy();
  });

  it('offers the ballot the moment the window opens and withdraws it the moment it closes, without reloading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const start = Date.now();
    rows = [
      {
        ...resolution,
        opensAt: new Date(start + MINUTE).toISOString(),
        closesAt: new Date(start + 2 * MINUTE).toISOString(),
      },
    ];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.NOT_OPEN_YET)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(MINUTE);
    });
    expect(ballotButtons().every(Boolean)).toBe(true);
    expect(screen.queryByText(PUBLICATION_COPY.NOT_OPEN_YET)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(MINUTE);
    });
    expect(ballotButtons().some(Boolean)).toBe(false);
    expect(screen.getByText(PUBLICATION_COPY.CLOSED)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.RESULT_PENDING)).toBeTruthy();
    expect(vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/api/v1/publications/').length).toBe(1);
  });
});

describe('a dividend declared to the members', () => {
  it('shows the rate, the frozen holding, the entitlement and the payment date, with nothing recorded yet', async () => {
    rows = [dividend];

    showPage();

    expect(await screen.findByText('Final dividend 2026')).toBeTruthy();
    expect(screen.getByText('Dividend')).toBeTruthy();
    expect(screen.getByText('AUD 0.025 per share')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.HOLDING_LABEL)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.ENTITLEMENT_LABEL)).toBeTruthy();
    expect(screen.getByText('AUD 2.50')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.PAYMENT_DATE_LABEL)).toBeTruthy();
    expect(screen.getByText('3 October 2026')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.RECORDS_ONLY)).toBeTruthy();
  });

  it('says the company recorded the payment, when and under what reference, and never that it was paid', async () => {
    rows = [{ ...dividend, myRecordedEntitlement: '2.50', myPaymentRecord: recorded }];

    showPage();

    expect(
      await screen.findByText('The company recorded this as paid on 3 October 2026, reference LDV-4412.'),
    ).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
  });

  it('says what part of a two-holding entitlement is recorded, and never that all of it was', async () => {
    rows = [
      { ...dividend, shares: '140', myEntitlement: '3.50', myRecordedEntitlement: '1.00', myPaymentRecord: recorded },
    ];

    showPage();

    expect(
      await screen.findByText(
        'The company has recorded AUD 1.00 of your AUD 3.50 as paid, most recently on 3 October 2' +
          '026, reference LDV-4412. The rest has no payment record yet.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('AUD 3.50')).toBeTruthy();
    expect(screen.queryByText('The company recorded this as paid on 3 October 2026, reference LDV-4412.')).toBeNull();
  });

  it('says there is nothing to pay when the holding comes to less than a cent', async () => {
    rows = [{ ...dividend, shares: '1', myEntitlement: '0.00' }];

    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.NOTHING_PAYABLE)).toBeTruthy();
    expect(screen.getByText('AUD 0.00')).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
  });

  it('shows none of this on a document', async () => {
    rows = [statement];

    showPage();

    expect(await screen.findByText('Annual holding statement 2026')).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.RATE_LABEL)).toBeNull();
    expect(screen.queryByText(PUBLICATION_COPY.NO_PAYMENT_RECORDED)).toBeNull();
  });
});

describe('personal Notices and preserved dividend behavior', () => {
  it('shows loading without calling pending notices empty or offering an action', async () => {
    let finish!: (value: unknown) => void;
    listing = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    showPage();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: PUBLICATION_COPY.OPEN })).toBeNull();
    await act(async () => finish({ data: { count: 1, next: null, previous: null, results: rows } }));
    expect(await screen.findByText(statement.title)).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(screen.getByRole('button', { name: PUBLICATION_COPY.OPEN })).toBeTruthy();
  });

  it('requests only addressed papers, excluding issuer-owned papers that were not addressed to the person', async () => {
    rows = [];
    ownedOnly = [{ ...statement, title: 'Issuer-only paper', shares: null }];
    const unfiltered = (await listing(1)) as { data: { results: unknown[] } };
    expect(unfiltered.data.results).toHaveLength(1);
    showPage();
    expect(await screen.findByText(PUBLICATION_COPY.EMPTY)).toBeTruthy();
    expect(screen.queryByText('Issuer-only paper')).toBeNull();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/publications/', { params: { page: 1, addressed: 'me' } });
  });

  it('does not reuse the old unfiltered publication cache', async () => {
    rows = [];
    client.setQueryData(['publications'], {
      pages: [
        {
          data: {
            count: 1,
            next: null,
            previous: null,
            results: [{ ...statement, title: 'Cached issuer-only paper' }],
          },
        },
      ],
      pageParams: [1],
    });
    showPage();
    expect(await screen.findByText(PUBLICATION_COPY.EMPTY)).toBeTruthy();
    expect(screen.queryByText('Cached issuer-only paper')).toBeNull();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/publications/', { params: { page: 1, addressed: 'me' } });
  });

  it('keeps the personal filter on every page, including the dividend rows merged into Notices', async () => {
    listing = async (page) => ({
      data: {
        count: 3,
        next: page === 1 ? 'https://api.example/api/v1/publications/?page=2' : null,
        previous: null,
        results: page === 1 ? [statement, resolution] : [dividend],
      },
    });
    showPage();
    expect(await screen.findByText(statement.title)).toBeTruthy();
    expect(screen.getByText(resolution.title)).toBeTruthy();
    fireEvent.click(screen.getByText(PUBLICATION_COPY.LOAD_MORE));
    expect(await screen.findByText(dividend.title)).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/publications/', { params: { page: 1, addressed: 'me' } });
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/publications/', { params: { page: 2, addressed: 'me' } });
    const article = within(screen.getByText(dividend.title).closest('article')!);
    expect(article.getByText('AUD 0.025 per share')).toBeTruthy();
    expect(article.getByText('AUD 2.50')).toBeTruthy();
    expect(article.getByText('3 October 2026')).toBeTruthy();
    expect(article.getByRole('button', { name: PUBLICATION_COPY.OPEN })).toBeTruthy();
  });

  it('preserves share and money precision and calendar dates without a floating-point conversion', async () => {
    rows = [
      {
        ...dividend,
        shares: '9007199254740993',
        myEntitlement: '9007199254740993.01',
        paymentDate: '2026-10-03',
        recordDate: '2026-09-20',
      },
    ];
    showPage();
    expect(await screen.findByText('9,007,199,254,740,993')).toBeTruthy();
    expect(screen.queryByText('9,007,199,254,740,992')).toBeNull();
    expect(screen.getByText('AUD 9,007,199,254,740,993.01')).toBeTruthy();
    expect(screen.getByText('20 September 2026')).toBeTruthy();
    expect(screen.getByText('3 October 2026')).toBeTruthy();
  });

  it('keeps earlier-page failure visible and retries that page without claiming the list is complete', async () => {
    let failing = true;
    listing = async (page) => {
      if (page === 2 && failing) throw new Error('Unavailable');
      return {
        data: {
          count: 2,
          previous: null,
          next: page === 1 ? 'https://api.example/api/v1/publications/?page=2' : null,
          results: page === 1 ? [statement] : [dividend],
        },
      };
    };
    showPage();
    fireEvent.click(await screen.findByText(PUBLICATION_COPY.LOAD_MORE));
    expect((await screen.findByRole('alert')).textContent).toContain('The list is incomplete.');
    expect(screen.getByText(statement.title)).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try earlier notices again' }));
    expect(await screen.findByText(dividend.title)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/v1/publications/', { params: { page: 2, addressed: 'me' } });
  });

  it('does not call zero known rows empty when another page is still outstanding or has failed', async () => {
    listing = async (page) => {
      if (page === 2) throw new Error('Unavailable');
      return {
        data: { count: 1, previous: null, next: 'https://api.example/api/v1/publications/?page=2', results: [] },
      };
    };
    showPage();
    expect(await screen.findByRole('button', { name: PUBLICATION_COPY.LOAD_MORE })).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.LOAD_MORE }));
    expect((await screen.findByRole('alert')).textContent).toContain('The list is incomplete.');
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try earlier notices again' })).toBeTruthy();
  });

  it('withholds cached rows and vote controls after refresh failure until retry succeeds', async () => {
    rows = [resolution];
    showPage();
    expect(await screen.findByRole('button', { name: 'For' })).toBeTruthy();
    const read = listing;
    listing = async () => {
      throw new Error('Unavailable');
    };
    await act(async () => client.invalidateQueries({ queryKey: ['publications'] }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be refreshed');
    expect(screen.queryByText(resolution.title)).toBeNull();
    expect(screen.queryByRole('button', { name: 'For' })).toBeNull();
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
    listing = read;
    fireEvent.click(screen.getByText(PUBLICATION_COPY.RETRY));
    expect(await screen.findByRole('button', { name: 'For' })).toBeTruthy();
  });

  it.each(['https://api.example/api/v1/publications/?page=1', 'https://api.example/api/v1/publications/'])(
    'rejects nonadvancing or malformed next-page links: %s',
    async (next) => {
      listing = async () => ({ data: { count: 2, previous: null, next, results: rows } });
      showPage();
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.queryByText(statement.title)).toBeNull();
    },
  );

  it('keeps a document pending until the download is ready and allows retry after delivery failure', async () => {
    let finish!: (value: { data: Blob }) => void;
    file = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: PUBLICATION_COPY.OPEN }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: PUBLICATION_COPY.OPENING }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(saved).toHaveLength(0);
    await act(async () => finish({ data: new Blob(['stored bytes'], { type: 'application/pdf' }) }));
    await waitFor(() => expect(saved).toHaveLength(1));
    file = async () => {
      throw { response: { status: 503 } };
    };
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.OPEN }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    file = async () => ({ data: new Blob(['retry bytes'], { type: 'application/pdf' }) });
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.OPEN }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables ballot confirmation while pending, retains refusal for retry, and invalidates the personal summary', async () => {
    rows = [resolution];
    client.setQueryData(['publications', 'summary'], { openResolutions: 1 });
    let reject!: (reason: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(
      () =>
        new Promise((_, refuse) => {
          reject = refuse;
        }),
    );
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: 'For' }));
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.CONFIRM }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: PUBLICATION_COPY.CASTING }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect((screen.getByRole('button', { name: PUBLICATION_COPY.CANCEL }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => reject({ response: { data: { detail: 'Ballot temporarily refused.' } } }));
    expect((await screen.findByRole('alert')).textContent).toBe('Ballot temporarily refused.');
    expect(client.getQueryState(['publications', 'summary'])?.isInvalidated).toBe(true);
    vi.mocked(apiClient.post).mockImplementation(async () => {
      const voted = {
        ...resolution,
        ballotOutstanding: false,
        myBallot: { choice: 'for', castAt: fromNow(0), staffEntered: false },
      };
      rows = [voted];
      return { data: voted };
    });
    fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.CONFIRM }));
    expect(await screen.findByText(PUBLICATION_COPY.YOU_VOTED.for)).toBeTruthy();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
