import type { AxiosRequestConfig } from 'axios';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { PUBLICATION_COPY, formatDateTime } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { PublicationsScreen } from './index';

jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('../../services/apiClient', () => ({
  apiClient: { get: jest.fn(async () => ({ data: {} })), post: jest.fn() },
}));

const LISTING = '/api/v1/publications/';
const UUID = 'publication-a';
const FILE = `/api/v1/publications/${UUID}/file/`;

const statement = {
  uuid: UUID,
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
  uuid: 'publication-r',
  kind: 'resolution',
  title: 'Resolution to adopt a constitution',
  question: 'That the company adopt the synthetic constitution tabled with this notice.',
  resolutionKind: 'ordinary',
  opensAt: fromNow(-HOUR),
  closesAt: fromNow(7 * 24 * HOUR),
};
const BALLOT = `/api/v1/publications/${resolution.uuid}/ballot/`;
const voted = { ...resolution, myBallot: { choice: 'for', castAt: fromNow(0), staffEntered: false } };

const tally = {
  for: { shares: '100', members: 1 },
  against: { shares: '40', members: 1 },
  abstain: { shares: '0', members: 0 },
  eligible: { shares: '150', members: 3 },
  carried: true,
};

const closed = { opensAt: fromNow(-48 * HOUR), closesAt: fromNow(-24 * HOUR) };

const choiceButton = (choice: string) => `${choice}: ${resolution.title}`;

const listingCalls = () => jest.mocked(apiClient.get).mock.calls.filter(([url]) => url === LISTING).length;

let client: QueryClient;
let rows: unknown[];
let served: () => Promise<unknown>;
let listing: (page: number) => Promise<unknown>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetFiles();
  rows = [statement];
  listing = async (page) => ({
    data: { count: rows.length, next: null, previous: null, results: page === 1 ? rows : [] },
  });
  const bytes = Uint8Array.from('%PDF', (character) => character.charCodeAt(0));
  served = async () => ({ data: bytes.buffer, headers: { 'content-type': 'application/pdf; charset=binary' } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest
    .mocked(apiClient.get)
    .mockImplementation(async (url: string, config?: AxiosRequestConfig) =>
      url === LISTING ? listing(config?.params?.page ?? 1) : served(),
    );
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  jest.mocked(apiClient.post).mockReset();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('lists what was published, the share class it concerns and the holding frozen on the record date', async () => {
  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText('Annual holding statement 2026')).toBeTruthy();
  expect(view.getByText('Annual holding statement')).toBeTruthy();
  expect(view.getByText('Synthetic Holdings Pty Ltd · Synthetic ordinary shares (SYN)')).toBeTruthy();
  expect(view.getByText(`${PUBLICATION_COPY.RECORD_DATE_LABEL} 20 September 2026`)).toBeTruthy();
  expect(view.getByText(`100 · ${PUBLICATION_COPY.HOLDING_LABEL}`)).toBeTruthy();
});

it('says so when nothing has been published, and offers no document to open', async () => {
  rows = [];

  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.EMPTY_TITLE)).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.OPEN)).toBeNull();
});

it('opens the document from one private copy through the route that audits the read', async () => {
  const copy = `${cache}ledova-document-views-v1/${UUID}.pdf`;
  const view = await render(<PublicationsScreen />, { wrapper });

  await fireEvent.press(await view.findByLabelText(`${PUBLICATION_COPY.OPEN}: ${statement.title}`));

  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(copy, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }),
  );
  expect(apiClient.get).toHaveBeenCalledWith(FILE, {
    ledovaSessionEpoch: getSessionEpoch(),
    responseType: 'arraybuffer',
  });
  expect(files.get(copy)?.content).toBe('%PDF');
});

it('writes no copy and says nothing was served when the read could not be recorded', async () => {
  const copy = `${cache}ledova-document-views-v1/${UUID}.pdf`;
  served = () => Promise.reject({ response: { status: 503 } });
  const view = await render(<PublicationsScreen />, { wrapper });

  await fireEvent.press(await view.findByLabelText(`${PUBLICATION_COPY.OPEN}: ${statement.title}`));

  expect(await view.findByText(PUBLICATION_COPY.UNDELIVERABLE)).toBeTruthy();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(files.has(copy)).toBe(false);
});

it('shows earlier publications a page at a time', async () => {
  const earlier = { ...statement, uuid: 'publication-b', title: 'Meeting notice 2025' };
  listing = async (page) =>
    page === 1
      ? { data: { count: 2, next: 'https://api.example/api/v1/publications/?page=2', previous: null, results: rows } }
      : { data: { count: 2, next: null, previous: null, results: [earlier] } };
  const view = await render(<PublicationsScreen />, { wrapper });

  await fireEvent.press(await view.findByText(PUBLICATION_COPY.LOAD_MORE));

  expect(await view.findByText('Meeting notice 2025')).toBeTruthy();
  expect(view.getByText('Annual holding statement 2026')).toBeTruthy();
  await waitFor(() => expect(view.queryByText(PUBLICATION_COPY.LOAD_MORE)).toBeNull());
});

it('says the listing failed rather than that nothing was published, and offers to try again', async () => {
  let failing = true;
  listing = async () => {
    if (failing) throw { response: { status: 500 } };
    return { data: { count: 1, next: null, previous: null, results: rows } };
  };
  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.LIST_FAILED)).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.EMPTY_TITLE)).toBeNull();
  failing = false;
  await fireEvent.press(view.getByText(PUBLICATION_COPY.RETRY));
  expect(await view.findByText('Annual holding statement 2026')).toBeTruthy();
});

it('shows a resolution with its question, kind, basis, window, that it is open and the frozen holding as the votes', async () => {
  rows = [resolution];

  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(resolution.question)).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.QUESTION_LABEL)).toBeTruthy();
  expect(view.getByText(`Ordinary resolution · ${PUBLICATION_COPY.BASIS}`)).toBeTruthy();
  expect(
    view.getByText(
      `${PUBLICATION_COPY.WINDOW_LABEL} ${formatDateTime(resolution.opensAt)} ${PUBLICATION_COPY.WINDOW_TO} ${formatDateTime(resolution.closesAt)}`,
    ),
  ).toBeTruthy();
  expect(view.getByText(`${PUBLICATION_COPY.OPEN_UNTIL} ${formatDateTime(resolution.closesAt)}`)).toBeTruthy();
  expect(view.getByText(`100 · ${PUBLICATION_COPY.VOTING_WEIGHT_LABEL}`)).toBeTruthy();
  expect(view.getByLabelText(choiceButton('For'))).toBeTruthy();
});

it('says a resolution whose window has not opened is not open yet, and offers no ballot', async () => {
  rows = [{ ...resolution, opensAt: fromNow(HOUR), closesAt: fromNow(2 * HOUR) }];

  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.NOT_OPEN_YET)).toBeTruthy();
  expect(view.queryByLabelText(choiceButton('For'))).toBeNull();
});

it('asks the member to confirm a ballot cannot be changed, and casts nothing when they cancel', async () => {
  rows = [resolution];
  const view = await render(<PublicationsScreen />, { wrapper });

  await fireEvent.press(await view.findByLabelText(choiceButton('Against')));

  expect(view.getByText(`${PUBLICATION_COPY.CONFIRM_TITLE} Against`)).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.CONFIRM_BODY)).toBeTruthy();
  expect(view.queryByLabelText(choiceButton('Against'))).toBeNull();
  await fireEvent.press(view.getByText(PUBLICATION_COPY.CANCEL));
  expect(view.getByLabelText(choiceButton('Against'))).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('casts the confirmed ballot inside its session and shows it from the refreshed listing', async () => {
  rows = [resolution];
  jest.mocked(apiClient.post).mockImplementation(async () => {
    rows = [voted];
    return { data: voted };
  });
  const view = await render(<PublicationsScreen />, { wrapper });

  await fireEvent.press(await view.findByLabelText(choiceButton('For')));
  await fireEvent.press(view.getByText(PUBLICATION_COPY.CONFIRM));

  expect(await view.findByText(PUBLICATION_COPY.YOU_VOTED.for)).toBeTruthy();
  expect(apiClient.post).toHaveBeenCalledWith(BALLOT, { choice: 'for' }, { ledovaSessionEpoch: getSessionEpoch() });
  expect(listingCalls()).toBe(2);
  expect(view.queryByLabelText(choiceButton('For'))).toBeNull();
  expect(view.queryByText(PUBLICATION_COPY.STAFF_ENTERED)).toBeNull();
});

it('lets a cast that outlives its session change nothing on screen, whether it succeeds or fails', async () => {
  for (const settle of ['resolve', 'reject'] as const) {
    rows = [resolution];
    let finish!: () => void;
    jest.mocked(apiClient.post).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            settle === 'resolve'
              ? resolve({ data: voted })
              : reject({ response: { status: 400, data: ['Voting on this resolution has closed.'] } });
        }),
    );
    const view = await render(<PublicationsScreen />, { wrapper });
    await fireEvent.press(await view.findByLabelText(choiceButton('For')));
    await fireEvent.press(view.getByText(PUBLICATION_COPY.CONFIRM));
    const listed = listingCalls();
    rows = [voted];

    await act(async () => {
      invalidateSessionScope();
      finish();
    });

    expect(listingCalls()).toBe(listed);
    expect(view.queryByText(PUBLICATION_COPY.YOU_VOTED.for)).toBeNull();
    expect(view.queryByText('Voting on this resolution has closed.')).toBeNull();
    await cleanup();
    client.clear();
  }
});

it('shows a ballot staff entered for the member as voted for them by staff', async () => {
  rows = [{ ...resolution, myBallot: { choice: 'against', castAt: fromNow(0), staffEntered: true } }];

  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.YOU_VOTED.against)).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.STAFF_ENTERED)).toBeTruthy();
  expect(view.queryByLabelText(choiceButton('For'))).toBeNull();
});

it('shows the route refusal as its own message', async () => {
  rows = [resolution];
  jest
    .mocked(apiClient.post)
    .mockRejectedValue({ response: { status: 400, data: ['Voting on this resolution has closed.'] } });
  const view = await render(<PublicationsScreen />, { wrapper });

  await fireEvent.press(await view.findByLabelText(choiceButton('Abstain')));
  await fireEvent.press(view.getByText(PUBLICATION_COPY.CONFIRM));

  expect(await view.findByText('Voting on this resolution has closed.')).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.YOU_VOTED.abstain)).toBeNull();
});

it('shows the result once closed: whether it carried, each count, and turnout against those eligible', async () => {
  rows = [{ ...resolution, ...closed, result: tally }];

  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.CARRIED)).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.CLOSED)).toBeTruthy();
  expect(view.getByText('For: 100 shares · 1 member')).toBeTruthy();
  expect(view.getByText('Against: 40 shares · 1 member')).toBeTruthy();
  expect(view.getByText('Abstain: 0 shares · 0 members')).toBeTruthy();
  expect(view.getByText(`${PUBLICATION_COPY.TURNOUT_LABEL}: 140 of 150 shares · 2 of 3 members`)).toBeTruthy();
  expect(view.queryByLabelText(choiceButton('For'))).toBeNull();
});

it('says a resolution that did not carry did not carry, and that one not yet counted is being counted', async () => {
  rows = [{ ...resolution, ...closed, result: { ...tally, carried: false } }];
  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(PUBLICATION_COPY.NOT_CARRIED)).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.CARRIED)).toBeNull();
  await cleanup();
  client.clear();

  rows = [{ ...resolution, ...closed }];
  const pending = await render(<PublicationsScreen />, { wrapper });

  expect(await pending.findByText(PUBLICATION_COPY.RESULT_PENDING)).toBeTruthy();
  expect(pending.queryByLabelText(choiceButton('For'))).toBeNull();
});

it('shows the company owner the result and never a ballot control', async () => {
  rows = [{ ...resolution, shares: null }];
  const view = await render(<PublicationsScreen />, { wrapper });

  expect(await view.findByText(resolution.question)).toBeTruthy();
  expect(view.queryByLabelText(choiceButton('For'))).toBeNull();
  expect(view.queryByText(new RegExp(PUBLICATION_COPY.VOTING_WEIGHT_LABEL))).toBeNull();
  await cleanup();
  client.clear();

  rows = [{ ...resolution, ...closed, shares: null, result: tally }];
  const later = await render(<PublicationsScreen />, { wrapper });

  expect(await later.findByText(PUBLICATION_COPY.CARRIED)).toBeTruthy();
  expect(later.queryByLabelText(choiceButton('For'))).toBeNull();
});
