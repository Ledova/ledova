import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { ApiClientProvider, OFFER_DOCUMENT_COPY } from '@ledova/shared';
import { DirectoryScreen } from './DirectoryScreen';
import { ShareClassScreen } from './ShareClassScreen';
import { DirectoryStackNavigator } from '../../navigation/DirectoryStackNavigator';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
let mockRole = { isInvestor: true, isLoading: false };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: mockParentNavigate }) }),
  useRoute: () => ({ params: { uuid: 'class-a' } }),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: ({ name, component: Component }: { name: string; component: React.ComponentType }) =>
      name === 'DirectoryMain' ? <Component /> : null,
  }),
}));
jest.mock('../../navigation/headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('../../hooks/useRole', () => ({ useRole: () => mockRole }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const eligibilityUrl = '/api/investor-classifications/eligibility/';
const listUrl = '/api/v1/directory/tokens/';
const detailUrl = `${listUrl}class-a/`;
const operatorUrl = '/api/operator/';
const documentsUrl = `${detailUrl}documents/`;
const memorandum = {
  uuid: 'memorandum',
  name: 'Information memorandum',
  documentType: 'prospectus',
  documentTypeDisplay: 'Prospectus or Information Memorandum',
  fileSize: 24576,
  mimeType: 'application/pdf',
  validFrom: null,
  validUntil: null,
  createdAt: '2026-09-01T00:00:00Z',
  fileUrl: `https://api.example.test${documentsUrl}memorandum/file/`,
};
const fileUrl = `${documentsUrl}${memorandum.uuid}/file/`;
const get = jest.mocked(apiClient.get);
let client: QueryClient;
let eligible: boolean;
let pages: Record<number, object>;
let token: ReturnType<typeof shareClass>;
let failure: string | null;
let notFound: boolean;
let documents: object[];

function shareClass(uuid = 'class-a') {
  return {
    uuid,
    companyUuid: 'issuer-a',
    name: uuid === 'class-a' ? 'Ordinary shares' : 'Preference shares',
    symbol: uuid === 'class-a' ? 'HARBOUR' : 'HARBOURP',
    totalSupply: '9007199254740993123456789',
    issuedShares: 123456,
    company: { displayName: 'Fictional Harbour Pty Ltd', industry: 'Fictional research', city: 'Sydney', state: 'NSW' },
    openOffering: {
      uuid: 'offer-a',
      pricePerShare: '12.30',
      priceCurrency: 'AUD',
      opensAt: '2026-09-01T10:00:00Z',
      closesAt: null,
    } as { uuid: string; pricePerShare: string; priceCurrency: 'AUD'; opensAt: string; closesAt: string | null } | null,
  };
}

beforeEach(() => {
  mockRole = { isInvestor: true, isLoading: false };
  eligible = true;
  token = shareClass();
  pages = { 1: { results: [token], next: null } };
  failure = null;
  notFound = false;
  documents = [memorandum];
  resetFiles();
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url, config) => {
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (failure === url || failure === `${url}${page}`) throw new Error('Synthetic read unavailable');
    if (url === eligibilityUrl) return { data: { isReady: eligible } };
    if (url === listUrl) return { data: pages[page] };
    if (url === detailUrl) {
      if (notFound) throw { response: { status: 404 } };
      return { data: token };
    }
    if (url === '/api/wallets/') return { data: { results: [], next: null } };
    if (url === documentsUrl) return { data: documents };
    if (url === fileUrl)
      return {
        data: Uint8Array.from('%PDF', (character) => character.charCodeAt(0)).buffer,
        headers: { 'content-type': 'application/pdf' },
      };
    if (url === operatorUrl) return { data: { name: 'Fictional Ledova Operator' } };
    throw new Error(`Unexpected request ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

it.each([
  [true, true],
  [false, false],
])('waits for an investing role before reading Directory (%s, %s)', async (isLoading, isInvestor) => {
  mockRole = { isLoading, isInvestor };
  const view = await render(<DirectoryStackNavigator onNotifications={() => {}} unreadCount={0} />, { wrapper });
  expect(get).not.toHaveBeenCalled();
  expect(view.queryByText('Directory')).toBeNull();
  mockRole = { isLoading: false, isInvestor: true };
  await view.rerender(<DirectoryStackNavigator onNotifications={() => {}} unreadCount={0} />);
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(listUrl, { params: { page: 1 } });
});

it('fetches the bounded catalogue without treating readiness as company admission and links to Verification', async () => {
  eligible = false;
  pages = { 1: { results: [], next: null } };
  const view = await render(<DirectoryScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Verification'));
  expect(mockParentNavigate).toHaveBeenCalledWith('InvestorEligibility');
  expect(get.mock.calls.map(([url]) => url)).toEqual([eligibilityUrl, listUrl]);
});

it('reads all class pages, keeps the simple cache separate and opens the selected class', async () => {
  pages = {
    1: { results: [token], next: `https://example.test${listUrl}?page=2` },
    2: { results: [shareClass('class-b')], next: null },
  };
  const oldCache = { data: { results: [], next: null } };
  client.setQueryData(['directory', 'tokens'], oldCache);
  const view = await render(<DirectoryScreen />, { wrapper });
  await fireEvent.press(await view.findByLabelText('Open Preference shares'));
  expect(view.getByText('Ordinary shares')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(listUrl, { params: { page: 2 } });
  expect(client.getQueryData(['directory', 'tokens'])).toEqual(oldCache);
  expect(mockNavigate).toHaveBeenCalledWith('DirectoryClass', { uuid: 'class-b' });
});

it.each([eligibilityUrl, listUrl, `${listUrl}2`])(
  'does not present failed %s as an empty or partial directory and recovers',
  async (url) => {
    pages = { 1: { results: [token], next: `https://example.test${listUrl}?page=2` }, 2: { results: [], next: null } };
    failure = url;
    const view = await render(<DirectoryScreen />, { wrapper });
    expect(await view.findByText(/The directory could not be loaded/)).toBeTruthy();
    expect(view.queryByText('No share classes available under your current company decisions.')).toBeNull();
    expect(view.queryByText('Ordinary shares')).toBeNull();
    expect(view.queryByText('Check your investor account')).toBeNull();
    failure = null;
    await fireEvent.press(view.getByText('Try again'));
    expect(await view.findByText('Ordinary shares')).toBeTruthy();
  },
);

it('shows a reliable empty directory only after both reads succeed', async () => {
  pages = { 1: { results: [], next: null } };
  const view = await render(<DirectoryScreen />, { wrapper });
  expect(await view.findByText('No share classes available under your current company decisions.')).toBeTruthy();
  expect(view.getByText('Share classes')).toBeTruthy();
  expect(view.queryByText('Check your investor account')).toBeNull();
});

it('hides cached classes during failed readiness checks and requires current account prerequisites', async () => {
  const view = await render(<DirectoryScreen />, { wrapper });
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  failure = eligibilityUrl;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['investor-eligibility'] });
  });
  expect(await view.findByText(/The directory could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Ordinary shares')).toBeNull();
  failure = null;
  eligible = false;
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('Check your investor account')).toBeTruthy();
  expect(view.queryByText('Ordinary shares')).toBeNull();
});

it('shows exact authorised shares, safe issued shares and AUD offering terms without collecting payment', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('9,007,199,254,740,993,123,456,789')).toBeTruthy();
  expect(view.getByText('123,456')).toBeTruthy();
  expect(view.getByText('AUD\u00a012.30')).toBeTruthy();
  expect(view.getByText('No closing date')).toBeTruthy();
  expect(await view.findByText('Add a receiving wallet')).toBeTruthy();
  expect(await view.findByText(/Fictional Ledova Operator reviews your application/)).toBeTruthy();
  await fireEvent.press(view.getByText('Back to Directory'));
  expect(mockNavigate).toHaveBeenCalledWith('DirectoryMain');
});

it.each([Number.MAX_SAFE_INTEGER + 1, -1])('does not invent an issued share count for %s', async (issuedShares) => {
  token.issuedShares = issuedShares;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Unavailable')).toBeTruthy();
  expect(view.getByText('9,007,199,254,740,993,123,456,789')).toBeTruthy();
});

it('suppresses stale class and offering terms after a failed refresh, then reflects closure', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Open for applications')).toBeTruthy();
  failure = detailUrl;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory', 'token'] });
  });
  expect(await view.findByText(/This share class could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Open for applications')).toBeNull();
  expect(view.queryByText('AUD\u00a012.30')).toBeNull();
  failure = null;
  token.openOffering = null;
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('No offering open')).toBeTruthy();
  expect(view.getByText('Ordinary shares')).toBeTruthy();
});

it.each([
  ['a failed read', () => (failure = detailUrl), /This share class could not be loaded/],
  ['the class becoming unavailable', () => (notFound = true), 'Share class not available'],
])('names the company under the title, and drops that lede with the class after %s', async (_, fail, state) => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  const title = view.getByRole('header', { name: 'Share class' });
  expect(title.parent!.children[1]).toBe(view.getByText('Fictional Harbour Pty Ltd'));
  fail();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory', 'token'] });
  });
  expect(await view.findByText(state)).toBeTruthy();
  expect(view.getByRole('header', { name: 'Share class' })).toBeTruthy();
  expect(view.queryByText('Fictional Harbour Pty Ltd')).toBeNull();
});

it('treats a newly unavailable class as unavailable even with a cached prior record', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  notFound = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory', 'token'] });
  });
  expect(await view.findByText('Share class not available')).toBeTruthy();
  expect(view.queryByText('Ordinary shares')).toBeNull();
  expect(view.queryByText('Open for applications')).toBeNull();
});

it('keeps class reads independent of operator failure and retries the operator explicitly', async () => {
  failure = operatorUrl;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Operator details could not be loaded.')).toBeTruthy();
  expect(view.getByText('Ordinary shares')).toBeTruthy();
  expect(view.queryByText(/reviews your application/)).toBeNull();
  failure = null;
  await fireEvent.press(view.getByText('Try operator details again'));
  expect(await view.findByText(/Fictional Ledova Operator reviews your application/)).toBeTruthy();
});

it('lists the offer documents and opens one from a private copy through the authenticated client', async () => {
  const copy = `${cache}ledova-document-views-v1/${memorandum.uuid}.pdf`;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Information memorandum')).toBeTruthy();
  expect(view.getByText('Prospectus or Information Memorandum · 24.0 KB · Uploaded 1 September 2026')).toBeTruthy();
  expect(view.getByText(OFFER_DOCUMENT_COPY.HELP)).toBeTruthy();

  await fireEvent.press(view.getByLabelText('View Information memorandum'));

  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(copy, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }),
  );
  expect(get).toHaveBeenCalledWith(fileUrl, { ledovaSessionEpoch: getSessionEpoch(), responseType: 'arraybuffer' });
  expect(get.mock.calls.some(([url]) => url === memorandum.fileUrl)).toBe(false);
  expect(files.get(copy)?.content).toBe('%PDF');
});

it('says so when a refused document cannot be opened, and keeps no copy', async () => {
  const copy = `${cache}ledova-document-views-v1/${memorandum.uuid}.pdf`;
  failure = fileUrl;
  const view = await render(<ShareClassScreen />, { wrapper });
  await fireEvent.press(await view.findByLabelText('View Information memorandum'));
  expect(await view.findByText(OFFER_DOCUMENT_COPY.OPEN_FAILED)).toBeTruthy();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(files.has(copy)).toBe(false);
});

it('shows the documents of approved offerings even when none is open now', async () => {
  token.openOffering = null;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('No offering open')).toBeTruthy();
  expect(await view.findByLabelText('View Information memorandum')).toBeTruthy();
});

it('says so when no document is attached, rather than showing an empty list', async () => {
  documents = [];
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText(OFFER_DOCUMENT_COPY.EMPTY)).toBeTruthy();
  expect(view.queryByText(OFFER_DOCUMENT_COPY.HELP)).toBeNull();
  expect(view.queryByText(OFFER_DOCUMENT_COPY.VIEW)).toBeNull();
});

it('keeps a failed document read distinct from having none and retries it alone', async () => {
  failure = documentsUrl;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText(OFFER_DOCUMENT_COPY.FAILED)).toBeTruthy();
  expect(view.queryByText(OFFER_DOCUMENT_COPY.EMPTY)).toBeNull();
  expect(view.getByText('Ordinary shares')).toBeTruthy();
  failure = null;
  await fireEvent.press(view.getByText(OFFER_DOCUMENT_COPY.RETRY));
  expect(await view.findByLabelText('View Information memorandum')).toBeTruthy();
});

it('pulls a document added to an approved offering into the page when the investor refreshes it', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByLabelText('View Information memorandum')).toBeTruthy();
  documents = [memorandum, { ...memorandum, uuid: 'supplement', name: 'Supplementary memorandum' }];

  await act(async () => {
    (RefreshControl as unknown as { latestRef: { props: { onRefresh: () => void } } }).latestRef.props.onRefresh();
  });

  expect(await view.findByLabelText('View Supplementary memorandum')).toBeTruthy();
  expect(view.getByLabelText('View Information memorandum')).toBeTruthy();
  expect(get.mock.calls.filter(([url]) => url === documentsUrl)).toHaveLength(2);
});

it('does not read documents for a class that is not available to the investor', async () => {
  notFound = true;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Share class not available')).toBeTruthy();
  expect(view.queryByText(OFFER_DOCUMENT_COPY.TITLE)).toBeNull();
  expect(get.mock.calls.some(([url]) => url === documentsUrl)).toBe(false);
});
