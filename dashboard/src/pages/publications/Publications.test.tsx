// @vitest-environment jsdom
import type { AxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { PUBLICATION_COPY, formatDateTime } from '@ledova/shared';
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
  result: null,
};

const HOUR = 60 * 60 * 1000;
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
};

const tally = {
  for: { shares: '100', members: 1 },
  against: { shares: '40', members: 1 },
  abstain: { shares: '0', members: 0 },
  eligible: { shares: '150', members: 3 },
  carried: true,
};

const closed = { opensAt: fromNow(-48 * HOUR), closesAt: fromNow(-24 * HOUR) };

let client: QueryClient;
let rows: unknown[];
let file: () => Promise<{ data: Blob }>;
let listing: (page: number) => Promise<unknown>;
let saved: { href: string | null; download: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [statement];
  file = async () => ({ data: new Blob(['stored bytes'], { type: 'application/pdf' }) });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  listing = async (page) => ({
    data: { count: rows.length, next: null, previous: null, results: page === 1 ? rows : [] },
  });
  vi.mocked(apiClient.get).mockImplementation(async (url: string, config?: AxiosRequestConfig) => {
    if (url === '/api/v1/publications/') return listing(config?.params?.page ?? 1);
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

    expect(await screen.findByText(PUBLICATION_COPY.EMPTY_TITLE)).toBeTruthy();
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
    expect(screen.queryByText(PUBLICATION_COPY.EMPTY_TITLE)).toBeNull();
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

  it('shows the company owner a publication it made, with no holding of its own', async () => {
    rows = [{ ...statement, shares: null }];

    showPage();

    expect(await screen.findByText('Annual holding statement 2026')).toBeTruthy();
    expect(screen.queryByText(PUBLICATION_COPY.HOLDING_LABEL)).toBeNull();
    expect(screen.getByText(PUBLICATION_COPY.OPEN)).toBeTruthy();
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
    const voted = { ...resolution, myBallot: { choice: 'for', castAt: fromNow(0), staffEntered: false } };
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
    rows = [{ ...resolution, myBallot: { choice: 'abstain', castAt: fromNow(0), staffEntered: true } }];

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

  it('shows the company owner the result and never a ballot control', async () => {
    rows = [{ ...resolution, shares: null }];

    showPage();

    expect(await screen.findByText(resolution.question)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
    expect(screen.queryByText(PUBLICATION_COPY.VOTING_WEIGHT_LABEL)).toBeNull();

    cleanup();
    client.clear();
    rows = [{ ...resolution, ...closed, shares: null, result: tally }];
    showPage();

    expect(await screen.findByText(PUBLICATION_COPY.CARRIED)).toBeTruthy();
    expect(ballotButtons().some(Boolean)).toBe(false);
  });
});
