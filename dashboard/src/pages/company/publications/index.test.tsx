// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PUBLICATION_COPY, type Publication } from '@ledova/shared';
import IssuerPublicationsPage from '.';
import { companyRecord, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const BASE = '/api/v1/publications/';
const COMPANY = '/api/v1/companies/company-one/';
const EMPTY = { count: 0, next: null, previous: null, results: [] };
const statement: Publication = {
  uuid: 'statement-one',
  kind: 'holding_statement',
  title: 'Annual statement',
  companyName: 'Harbour Example Pty Ltd',
  tokenName: 'Ordinary shares',
  tokenSymbol: 'ORD',
  recordDate: '2026-09-20',
  shares: '987654321',
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
let client: QueryClient;
let fail: string | null;
let rows: Publication[];
let read: (page: number) => Promise<unknown>;
let downloads: string[];
function show() {
  return renderCompanyPage(client, <IssuerPublicationsPage />, 'Published to your members');
}
beforeEach(() => {
  vi.resetAllMocks();
  fail = null;
  rows = [statement];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  read = async () => ({ data: { ...EMPTY, count: rows.length, results: rows } });
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number; issuer?: string } }) => {
    if (url === fail) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [{ uuid: 'company-one' }] } };
    if (url === COMPANY) return { data: companyRecord() };
    if (url === BASE) {
      if (config?.params?.issuer !== 'company-one')
        return { data: { ...EMPTY, results: [{ ...statement, title: 'Personal foreign-company notice' }] } };
      return read(config.params.page ?? 1);
    }
    if (url === `${BASE}${statement.uuid}/file/`)
      return { data: new Blob(['stored document'], { type: 'application/pdf' }) };
    throw new Error(`Unexpected request: ${url}`);
  });
  URL.createObjectURL = vi.fn(() => 'blob:issuer-copy');
  URL.revokeObjectURL = vi.fn();
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('reads every page for the selected issuer without reusing the personal Notices cache', async () => {
  client.setQueryData(['publications', 'addressed', 'me'], {
    pages: [{ data: { ...EMPTY, results: [{ ...statement, title: 'Personal cached notice' }] } }],
    pageParams: [1],
  });
  read = async (page) => ({
    data: {
      ...EMPTY,
      count: 2,
      results: [
        { ...statement, uuid: `statement-${page}`, title: page === 1 ? 'First issuer record' : 'Last issuer record' },
      ],
      next: page === 1 ? 'https://example.invalid/publications/?page=2' : null,
    },
  });
  show();
  expect(await screen.findByText('Last issuer record')).toBeTruthy();
  expect(screen.getByText('2 publications')).toBeTruthy();
  expect(screen.getByText('First issuer record')).toBeTruthy();
  expect(screen.queryByText('Personal cached notice')).toBeNull();
  expect(screen.queryByText('Personal foreign-company notice')).toBeNull();
  expect(api.get).toHaveBeenCalledWith(BASE, { params: { page: 1, issuer: 'company-one' } });
  expect(api.get).toHaveBeenCalledWith(BASE, { params: { page: 2, issuer: 'company-one' } });
  expect(screen.getByRole('link', { name: 'Notices' }).getAttribute('href')).toBe('/publications');
  expect(screen.getByRole('link', { name: 'Back to Company' }).getAttribute('href')).toBe('/company');
});

it('distinguishes a successful empty list', async () => {
  rows = [];
  show();
  expect(await screen.findByText("Nothing has been published to this company's members yet.")).toBeTruthy();
  expect(screen.queryByRole('button', { name: PUBLICATION_COPY.OPEN })).toBeNull();
});

it.each([1, 2])('suppresses partial records when page %s fails and retries all pages', async (failedPage) => {
  let broken = true;
  read = async (page) => {
    if (page === failedPage && broken) throw new Error('Page unavailable');
    return {
      data: {
        ...EMPTY,
        count: 2,
        results: [{ ...statement, uuid: `statement-${page}`, title: `Record ${page}` }],
        next: page === 1 ? 'https://example.invalid/publications/?page=2' : null,
      },
    };
  };
  show();
  const retry = await screen.findByRole('button', { name: 'Retry publications' });
  expect(screen.queryByText('Record 1')).toBeNull();
  expect(screen.queryByText("Nothing has been published to this company's members yet.")).toBeNull();
  broken = false;
  fireEvent.click(retry);
  expect(await screen.findByText('Record 2')).toBeTruthy();
});

it.each(['https://example.invalid/publications/?page=1', 'https://example.invalid/publications/?page=bad'])(
  'refuses a non-advancing pagination link %s',
  async (next) => {
    read = async () => ({ data: { ...EMPTY, results: [statement], next } });
    show();
    expect(await screen.findByRole('button', { name: 'Retry publications' })).toBeTruthy();
    expect(api.get.mock.calls.filter(([url]) => url === BASE)).toHaveLength(1);
  },
);

it('blocks stale document actions during refresh and hides them after failure until retry succeeds', async () => {
  show();
  await screen.findByText('Annual statement');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  read = async () => {
    await held;
    throw new Error('Refresh failed');
  };
  let refresh!: Promise<unknown>;
  act(() => {
    refresh = client.invalidateQueries({ queryKey: ['publications', 'issuer'] });
  });
  const open = screen.getByRole('button', { name: PUBLICATION_COPY.OPEN }) as HTMLButtonElement;
  await waitFor(() => expect(open.disabled).toBe(true));
  fireEvent.click(open);
  expect(api.get.mock.calls.some(([url]) => String(url).includes('/file/'))).toBe(false);
  await act(async () => {
    release();
    await refresh;
  });
  const retry = await screen.findByRole('button', { name: 'Retry publications' });
  expect(screen.queryByText('Annual statement')).toBeNull();
  read = async () => ({ data: { ...EMPTY, results: [statement] } });
  fireEvent.click(retry);
  expect(await screen.findByText('Annual statement')).toBeTruthy();
});

it.each(['/api/v1/companies/', COMPANY])(
  'treats failed %s reads as errors and retries without an empty company claim',
  async (endpoint) => {
    fail = endpoint;
    show();
    const retry = await screen.findByRole('button', { name: 'Retry company information' });
    expect(screen.queryByText('No company information available.')).toBeNull();
    expect(screen.queryByText('Annual statement')).toBeNull();
    fail = null;
    fireEvent.click(retry);
    expect(await screen.findByText('Annual statement')).toBeTruthy();
  },
);

it('makes no publication request when there is no owned company', async () => {
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config: unknown) =>
    url === '/api/v1/companies/' ? Promise.resolve({ data: EMPTY }) : original(url, config),
  );
  show();
  expect(await screen.findByText('No company information available.')).toBeTruthy();
  expect(api.get.mock.calls.some(([url]) => url === BASE)).toBe(false);
});

it('shows exact issuer tally and dividend facts without personal voting or entitlements even when the owner is a member', async () => {
  rows = [
    {
      ...statement,
      kind: 'resolution',
      title: 'Constitution resolution',
      question: 'Adopt the constitution?',
      resolutionKind: 'special',
      opensAt: '2026-01-01T00:00:00Z',
      closesAt: '2026-01-02T00:00:00Z',
      ballotOutstanding: true,
      myBallot: { choice: 'for', castAt: '2026-01-01T01:00:00Z', staffEntered: false },
      result: {
        for: { shares: '9007199254740993', members: 1 },
        against: { shares: '0', members: 0 },
        abstain: { shares: '1', members: 1 },
        eligible: { shares: '9007199254740994', members: 2 },
        carried: true,
      },
    },
    {
      ...statement,
      uuid: 'dividend-one',
      kind: 'distribution',
      title: 'Company dividend',
      currency: 'AUD',
      ratePerShare: '0.123456',
      declaredOn: '2026-09-13',
      paymentDate: '2026-10-03',
      myEntitlement: '456.78',
      myRecordedEntitlement: '123.45',
    },
  ];
  show();
  expect(await screen.findByText('9,007,199,254,740,993 shares · 1 member')).toBeTruthy();
  expect(screen.getByText('9,007,199,254,740,994 of 9,007,199,254,740,994 shares · 2 of 2 members')).toBeTruthy();
  expect(screen.getByText('AUD 0.123456 per share')).toBeTruthy();
  expect(screen.getByText('3 October 2026')).toBeTruthy();
  expect(screen.queryByText('456.78')).toBeNull();
  expect(screen.queryByText('987654321')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Vote for' })).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('distinguishes a closed pending result from an open vote without supplying member voting controls', async () => {
  rows = [
    { ...statement, kind: 'resolution', opensAt: '2020-01-01T00:00:00Z', closesAt: '2020-01-02T00:00:00Z' },
    {
      ...statement,
      uuid: 'open',
      title: 'Open resolution',
      kind: 'resolution',
      opensAt: '2020-01-01T00:00:00Z',
      closesAt: '2099-01-01T00:00:00Z',
      ballotOutstanding: true,
    },
  ];
  show();
  expect(await screen.findByText(PUBLICATION_COPY.RESULT_PENDING)).toBeTruthy();
  expect(screen.getByText('Voting is open')).toBeTruthy();
  const article = screen.getByText('Open resolution').closest('article')!;
  expect(within(article).getAllByRole('button')).toHaveLength(1);
});

it.each([503, 500])('surfaces a file HTTP %s refusal and retries the same stored document', async (status) => {
  const original = api.get.getMockImplementation()!;
  let broken = true;
  api.get.mockImplementation((url: string, config: unknown) => {
    if (url.endsWith('/file/') && broken) return Promise.reject({ response: { status } });
    return original(url, config);
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: PUBLICATION_COPY.OPEN }));
  expect(
    await screen.findByText(status === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED),
  ).toBeTruthy();
  expect(downloads).toEqual([]);
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: PUBLICATION_COPY.OPEN }));
  await waitFor(() => expect(downloads).toEqual(['statement-one.pdf']));
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(api.get).toHaveBeenCalledWith(`${BASE}statement-one/file/`, { responseType: 'blob' });
});
