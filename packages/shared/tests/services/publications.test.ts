import type { AxiosInstance } from 'axios';
import type { AxiosResponse } from 'axios';
import {
  BALLOT_CHOICES,
  DIVIDEND_FILTERS,
  PUBLICATION_COPY,
  PUBLICATION_ENDPOINTS,
  PUBLICATION_KIND_LABELS,
  PUBLICATION_NOTICE,
  RESOLUTION_KIND_LABELS,
  describeCount,
  describeTurnout,
  LONGEST_TIMER_DELAY,
  nextResolutionBoundary,
  publicationFilename,
  resolutionStatus,
} from '../../src/constants';
import {
  castBallot,
  downloadPublication,
  getPublicationSummary,
  getPublications,
  getPublicationsNextPage,
  openPublication,
} from '../../src/services/publications';
import type { PublicationResult, PublicationSummary } from '../../src/types';
import {
  describePaymentRecord,
  describePaymentStanding,
  describePublicationSummary,
  describeRate,
  formatDateTime,
  formatMoney,
  paymentRecordState,
} from '../../src/utils';

const OPENS = '2026-09-24T00:00:00Z';
const CLOSES = '2026-10-01T00:00:00Z';

const tally = (overrides: Partial<PublicationResult> = {}): PublicationResult => ({
  for: { shares: '100', members: 1 },
  against: { shares: '40', members: 1 },
  abstain: { shares: '0', members: 0 },
  eligible: { shares: '150', members: 3 },
  carried: true,
  ...overrides,
});

describe('publication services', () => {
  const get = jest.fn();
  const post = jest.fn();
  const apiClient = { get, post } as unknown as AxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the publications addressed to the caller without naming anyone, a page at a time', () => {
    getPublications(apiClient);
    getPublications(apiClient, 3);

    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/publications/', { params: { page: 1 } });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/publications/', { params: { page: 3 } });
  });

  it('narrows the listing by the filters the caller names, a page at a time', () => {
    getPublications(apiClient, 2, { kind: 'resolution' });
    getPublications(apiClient, 1, DIVIDEND_FILTERS);

    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/publications/', { params: { page: 2, kind: 'resolution' } });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/publications/', {
      params: { page: 1, kind: 'distribution', addressed: 'me' },
    });
  });

  it('reads the summary of what was published to the caller from its own route', () => {
    getPublicationSummary(apiClient);

    expect(PUBLICATION_ENDPOINTS.SUMMARY).toBe(`${PUBLICATION_ENDPOINTS.BASE}summary/`);
    expect(get).toHaveBeenCalledWith('/api/v1/publications/summary/');
  });

  it('reads the next page from the listing, and stops when there is none', () => {
    const page = (next: string | null) => ({ data: { count: 30, next, previous: null, results: [] } }) as AxiosResponse;

    expect(getPublicationsNextPage(page('https://api.example/api/v1/publications/?page=2'))).toBe(2);
    expect(getPublicationsNextPage(page(null))).toBeUndefined();
  });

  it('names a downloaded copy from the type served, since the stored object is not named for it', () => {
    expect(publicationFilename('publication-a', 'application/pdf')).toBe('publication-a.pdf');
    expect(publicationFilename('publication-a', 'image/jpeg; charset=binary')).toBe('publication-a.jpg');
    expect(publicationFilename('publication-a', 'application/octet-stream')).toBe('publication-a');
  });

  it('opens a document as a blob through the route that audits the read', () => {
    openPublication(apiClient, 'publication-a');

    expect(get).toHaveBeenCalledWith('/api/v1/publications/publication-a/file/', { responseType: 'blob' });
  });

  it('downloads the same document as bytes, carrying the caller config but never its response type', () => {
    downloadPublication(apiClient, 'publication-a', { timeout: 1000, responseType: 'json' });

    expect(get).toHaveBeenCalledWith('/api/v1/publications/publication-a/file/', {
      timeout: 1000,
      responseType: 'arraybuffer',
    });
  });

  it('builds the file and ballot routes from the listing route, so one prefix moves all three', () => {
    expect(PUBLICATION_ENDPOINTS.FILE('publication-a')).toBe(`${PUBLICATION_ENDPOINTS.BASE}publication-a/file/`);
    expect(PUBLICATION_ENDPOINTS.BALLOT('publication-a')).toBe(`${PUBLICATION_ENDPOINTS.BASE}publication-a/ballot/`);
  });

  it('casts a ballot with the choice alone, carrying the caller config', () => {
    castBallot(apiClient, 'publication-a', 'against');
    castBallot(apiClient, 'publication-b', 'abstain', { timeout: 1000 });

    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/publications/publication-a/ballot/', { choice: 'against' }, {});
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/publications/publication-b/ballot/',
      { choice: 'abstain' },
      {
        timeout: 1000,
      },
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('labels every kind the backend can publish', () => {
    expect(Object.keys(PUBLICATION_KIND_LABELS).sort()).toEqual([
      'distribution',
      'holding_statement',
      'meeting_notice',
      'resolution',
    ]);
  });

  it('names the notice type the backend sends, so a deep link can be recognised', () => {
    expect(PUBLICATION_NOTICE).toBe('publication');
  });
});

describe('a resolution in the listing', () => {
  const window = { opensAt: OPENS, closesAt: CLOSES, result: null };

  it('is not open yet before its window, open inside it and closed from the moment it ends', () => {
    expect(resolutionStatus(window, new Date('2026-09-23T23:59:59Z'))).toBe('upcoming');
    expect(resolutionStatus(window, new Date(OPENS))).toBe('open');
    expect(resolutionStatus(window, new Date('2026-09-30T23:59:59Z'))).toBe('open');
    expect(resolutionStatus(window, new Date(CLOSES))).toBe('closed');
  });

  it('is closed once it has a result, whatever the clock on this device says', () => {
    expect(resolutionStatus({ ...window, result: tally() }, new Date('2026-09-25T00:00:00Z'))).toBe('closed');
  });

  it('names the next moment its status changes, and none once it has closed or been counted', () => {
    expect(nextResolutionBoundary(window, new Date('2026-09-23T12:00:00Z'))).toBe(Date.parse(OPENS));
    expect(nextResolutionBoundary(window, new Date(OPENS))).toBe(Date.parse(CLOSES));
    expect(nextResolutionBoundary(window, new Date(CLOSES))).toBeNull();
    expect(nextResolutionBoundary({ ...window, result: tally() }, new Date(OPENS))).toBeNull();
    expect(nextResolutionBoundary({ opensAt: null, closesAt: null, result: null }, new Date(OPENS))).toBeNull();
  });

  it('caps a timer at the longest delay a timer can hold', () => {
    expect(LONGEST_TIMER_DELAY).toBe(2147483647);
  });

  it('has no status when the publication has no voting window', () => {
    expect(resolutionStatus({ opensAt: null, closesAt: null, result: null }, new Date(OPENS))).toBeNull();
  });

  it('labels every choice, every ballot and every kind of resolution the backend can send', () => {
    expect([...BALLOT_CHOICES].sort()).toEqual(['abstain', 'against', 'for']);
    expect(Object.keys(PUBLICATION_COPY.CHOICES).sort()).toEqual([...BALLOT_CHOICES].sort());
    expect(Object.keys(PUBLICATION_COPY.YOU_VOTED).sort()).toEqual([...BALLOT_CHOICES].sort());
    expect(Object.keys(RESOLUTION_KIND_LABELS).sort()).toEqual(['ordinary', 'special']);
    expect(PUBLICATION_COPY.BASIS).toBe('One vote per share');
  });

  it('describes a count in shares and members, with one member said once', () => {
    expect(describeCount({ shares: '1250', members: 2 })).toBe('1,250 shares · 2 members');
    expect(describeCount({ shares: '40', members: 1 })).toBe('40 shares · 1 member');
    expect(describeCount({ shares: '0', members: 0 })).toBe('0 shares · 0 members');
  });

  it('counts turnout as every share and member that voted, abstentions included, against those eligible', () => {
    expect(describeTurnout(tally({ abstain: { shares: '5', members: 1 } }))).toBe('145 of 150 shares · 3 of 3 members');
    expect(describeTurnout(tally())).toBe('140 of 150 shares · 2 of 3 members');
  });

  it('adds and groups share counts exactly beyond the range a number can hold', () => {
    const large = '12345678901234567890';

    expect(
      describeTurnout(
        tally({
          for: { shares: large, members: 1 },
          abstain: { shares: '10', members: 1 },
          eligible: { shares: '99999999999999999999', members: 4 },
        }),
      ),
    ).toBe('12,345,678,901,234,567,940 of 99,999,999,999,999,999,999 shares · 3 of 4 members');
  });
});

describe('a distribution in the listing', () => {
  it('shows an amount of money in cents exactly, grouped, beyond the range a number can hold', () => {
    expect(formatMoney('2.50', 'AUD')).toBe('AUD 2.50');
    expect(formatMoney('0.00', 'AUD')).toBe('AUD 0.00');
    expect(formatMoney('1234567890123456.78', 'AUD')).toBe('AUD 1,234,567,890,123,456.78');
  });

  it('shows the rate to every decimal place the company declared and no trailing zeros past the cent', () => {
    expect(describeRate({ ratePerShare: '0.025000', currency: 'AUD' })).toBe('AUD 0.025 per share');
    expect(describeRate({ ratePerShare: '0.123456', currency: 'AUD' })).toBe('AUD 0.123456 per share');
    expect(describeRate({ ratePerShare: '1.500000', currency: 'AUD' })).toBe('AUD 1.50 per share');
    expect(describeRate({ ratePerShare: '1000.000000', currency: 'AUD' })).toBe('AUD 1,000.00 per share');
    expect(describeRate({ ratePerShare: null, currency: null })).toBeNull();
  });

  it('says the company recorded the payment, when and under what reference, and never that it was paid', () => {
    const line = describePaymentRecord({
      recordedPaidOn: '2026-10-03',
      reference: 'LDV-4412',
      recordedAt: '2026-10-03T04:00:00Z',
    });

    expect(line).toBe('The company recorded this as paid on 3 October 2026, reference LDV-4412.');
  });

  const record = { recordedPaidOn: '2026-10-03', reference: 'LDV-4412', recordedAt: '2026-10-03T04:00:00Z' };
  const standing = (
    myRecordedEntitlement: string,
    myEntitlement = '3.50',
    myPaymentRecord: typeof record | null = record,
  ) => ({
    myEntitlement,
    myRecordedEntitlement,
    myPaymentRecord,
    currency: 'AUD',
  });

  it('tells a whole record, a part record and no record apart by the amounts, exactly to the cent', () => {
    expect(paymentRecordState(standing('3.50'))).toBe('recorded');
    expect(paymentRecordState(standing('1.00'))).toBe('partly_recorded');
    expect(paymentRecordState(standing('3.49'))).toBe('partly_recorded');
    expect(paymentRecordState(standing('0.00', '3.50', null))).toBe('unrecorded');
    expect(paymentRecordState(standing('12345678901234567.89', '12345678901234567.90'))).toBe('partly_recorded');
  });

  it('says the whole entitlement is recorded only when the recorded amount is all of it', () => {
    expect(describePaymentStanding(standing('3.50'))).toBe(
      'The company recorded this as paid on 3 October 2026, reference LDV-4412.',
    );
  });

  it('says what part of the entitlement is recorded, and that the rest has no record, never that it was all paid', () => {
    expect(describePaymentStanding(standing('1.00'))).toBe(
      'The company has recorded AUD 1.00 of your AUD 3.50 as paid, most recently on 3 October 2026, ' +
        'reference LDV-4412. The rest has no payment record yet.',
    );
  });

  it('says no payment is recorded, or that nothing is payable, when nothing stands', () => {
    expect(describePaymentStanding(standing('0.00', '3.50', null))).toBe(PUBLICATION_COPY.NO_PAYMENT_RECORDED);
    expect(describePaymentStanding(standing('0.00', '0.00', null))).toBe(PUBLICATION_COPY.NOTHING_PAYABLE);
  });

  it('has no member-facing copy that says paid without saying recorded', () => {
    const copy = Object.entries(PUBLICATION_COPY).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    const claimsPaid = (text: string) => /paid/i.test(text);
    const saysRecorded = (text: string) => /recorded/i.test(text);

    expect(copy.some(([key, text]) => claimsPaid(key) || claimsPaid(text))).toBe(true);
    expect(copy.filter(([key]) => claimsPaid(key) && !saysRecorded(key))).toEqual([]);
    expect(copy.filter(([, text]) => claimsPaid(text) && !saysRecorded(text))).toEqual([]);
  });
});

describe('the summary of what was published to a member', () => {
  const nothing: PublicationSummary = {
    openResolutions: 0,
    nextClosesAt: null,
    publishedSince: 0,
    dividendsWithoutRecord: 0,
  };
  const closes = '2026-10-02T07:00:00Z';

  it('says nothing when every count is zero', () => {
    expect(describePublicationSummary(nothing)).toEqual([]);
  });

  it('says each count once, in the singular, with the closing time formatted by the shared helper', () => {
    expect(
      describePublicationSummary({
        openResolutions: 1,
        nextClosesAt: closes,
        publishedSince: 1,
        dividendsWithoutRecord: 1,
      }),
    ).toEqual([
      '1 thing published to you in the last 30 days',
      `1 resolution awaiting your vote, closing ${formatDateTime(closes)}`,
      '1 dividend awaiting a payment record',
    ]);
  });

  it('says a count above one in the plural, and names the first of several resolutions to close', () => {
    expect(
      describePublicationSummary({
        openResolutions: 2,
        nextClosesAt: closes,
        publishedSince: 3,
        dividendsWithoutRecord: 2,
      }),
    ).toEqual([
      '3 things published to you in the last 30 days',
      `2 resolutions awaiting your vote, the first closing ${formatDateTime(closes)}`,
      '2 dividends awaiting a payment record',
    ]);
  });

  it('leaves out each count that is zero', () => {
    expect(describePublicationSummary({ ...nothing, dividendsWithoutRecord: 1 })).toEqual([
      '1 dividend awaiting a payment record',
    ]);
  });
});
