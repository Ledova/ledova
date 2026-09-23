// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { PUBLICATION_COPY } from '@ledova/shared';
import PublicationsPage from './index';

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn() } }));

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
};

let client: QueryClient;
let rows: unknown[];
let file: () => Promise<{ data: Blob }>;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [statement];
  file = async () => ({ data: new Blob(['stored bytes'], { type: 'application/pdf' }) });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/v1/publications/') return { data: { count: rows.length, results: rows } };
    return file();
  });
  window.open = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:a-private-copy');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
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
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith('blob:a-private-copy', '_blank', 'noopener,noreferrer'),
    );
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
