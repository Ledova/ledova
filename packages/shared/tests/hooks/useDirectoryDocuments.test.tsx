/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { ReactNode } from 'react';

import { DIRECTORY_ENDPOINTS } from '../../src/constants';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useDirectoryDocuments } from '../../src/hooks/useDirectory';

const api = { get: jest.fn() };
const memorandum = { uuid: 'memorandum', name: 'Information memorandum' };
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  api.get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads nothing until the class itself is available', async () => {
  const view = renderHook(() => useDirectoryDocuments('class-a', false), { wrapper });
  await act(async () => {});

  expect(api.get).not.toHaveBeenCalled();
  expect(view.result.current).toMatchObject({ documents: [], isLoading: false, hasError: false });
});

it('reads the documents of the class under that class', async () => {
  api.get.mockResolvedValue({ data: [memorandum] });
  const view = renderHook(() => useDirectoryDocuments('class-a', true), { wrapper });

  await waitFor(() => expect(view.result.current.documents).toEqual([memorandum]));
  expect(api.get).toHaveBeenCalledWith(DIRECTORY_ENDPOINTS.TOKENS.DOCUMENTS('class-a'));
  expect(client.getQueryData(['directory', 'token', 'class-a', 'documents'])).toEqual([memorandum]);
});

it('reports a failed read and reads again on retry', async () => {
  api.get.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ data: [memorandum] });
  const view = renderHook(() => useDirectoryDocuments('class-a', true), { wrapper });
  await waitFor(() => expect(view.result.current.hasError).toBe(true));
  expect(view.result.current.documents).toEqual([]);

  await act(async () => {
    await view.result.current.retry();
  });

  await waitFor(() => expect(view.result.current.documents).toEqual([memorandum]));
  expect(view.result.current.hasError).toBe(false);
});
