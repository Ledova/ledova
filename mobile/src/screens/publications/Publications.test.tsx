import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { PUBLICATION_COPY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { PublicationsScreen } from './index';

jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(async () => ({ data: {} })) } }));

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
};

let client: QueryClient;
let rows: unknown[];
let served: () => Promise<unknown>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetFiles();
  rows = [statement];
  const bytes = Uint8Array.from('%PDF', (character) => character.charCodeAt(0));
  served = async () => ({ data: bytes.buffer, headers: { 'content-type': 'application/pdf; charset=binary' } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest
    .mocked(apiClient.get)
    .mockImplementation(async (url: string) =>
      url === LISTING ? { data: { count: rows.length, results: rows } } : served(),
    );
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
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
