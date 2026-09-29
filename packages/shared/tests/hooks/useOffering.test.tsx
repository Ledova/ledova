/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { ReactNode } from 'react';

import { OFFERING_ENDPOINTS } from '../../src/constants';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useOfferingSubscriptions, useOfferingUnderEdit } from '../../src/hooks/useOffering';

const api = { get: jest.fn() };
const offering = { uuid: 'offering-a', status: 'draft', canBeEdited: true, summary: 'An example offering' };
const subscription = (number: number) => ({ uuid: `subscription-${number}`, investorName: `Investor ${number}` });
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function page(results: object[], next: string | null = null) {
  return { data: { results, next, previous: null, count: results.length } };
}

beforeEach(() => {
  api.get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('useOfferingUnderEdit', () => {
  it('reads nothing for a new offering', async () => {
    const view = renderHook(() => useOfferingUnderEdit(undefined), { wrapper });
    await act(async () => {});

    expect(view.result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('reads the current offering as its body under that offering', async () => {
    api.get.mockResolvedValue({ data: offering });
    const view = renderHook(() => useOfferingUnderEdit(offering.uuid), { wrapper });

    await waitFor(() => expect(view.result.current.data).toEqual(offering));
    expect(api.get).toHaveBeenCalledWith(OFFERING_ENDPOINTS.DETAIL(offering.uuid));
    expect(client.getQueryData(['offering', offering.uuid])).toEqual(offering);
  });

  it('reads the offering again each time the editor opens, even with a copy cached', async () => {
    api.get.mockResolvedValue({ data: offering });
    const first = renderHook(() => useOfferingUnderEdit(offering.uuid), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    api.get.mockResolvedValue({ data: { ...offering, canBeEdited: false, status: 'submitted' } });
    const second = renderHook(() => useOfferingUnderEdit(offering.uuid), { wrapper });

    await waitFor(() => expect(second.result.current.data?.status).toBe('submitted'));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('reads the offering again when the offerings are refreshed', async () => {
    api.get.mockResolvedValue({ data: offering });
    const view = renderHook(() => useOfferingUnderEdit(offering.uuid), { wrapper });
    await waitFor(() => expect(view.result.current.data).toEqual(offering));

    api.get.mockResolvedValue({ data: { ...offering, canBeEdited: false } });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['offering'] });
    });

    await waitFor(() => expect(view.result.current.data?.canBeEdited).toBe(false));
  });
});

describe('useOfferingSubscriptions', () => {
  const later = `https://example.invalid${OFFERING_ENDPOINTS.SUBSCRIPTIONS(offering.uuid)}?page=2`;

  it('reads nothing until an offering is chosen', async () => {
    const view = renderHook(() => useOfferingSubscriptions(undefined), { wrapper });
    await act(async () => {});

    expect(view.result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reads every page of the offering's applications under that offering", async () => {
    api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) =>
      config?.params?.page === 1 ? page([subscription(1)], later) : page([subscription(2)]),
    );
    const view = renderHook(() => useOfferingSubscriptions(offering.uuid), { wrapper });

    await waitFor(() => expect(view.result.current.data).toEqual([subscription(1), subscription(2)]));
    expect(api.get.mock.calls).toEqual([
      [OFFERING_ENDPOINTS.SUBSCRIPTIONS(offering.uuid), { params: { page: 1 } }],
      [OFFERING_ENDPOINTS.SUBSCRIPTIONS(offering.uuid), { params: { page: 2 } }],
    ]);
    expect(client.getQueryData(['offering-subscriptions', offering.uuid])).toHaveLength(2);
  });

  it('never presents part of the applications when a later page fails, and reads every page again', async () => {
    let broken = true;
    api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) => {
      if (config?.params?.page === 1) return page([subscription(1)], later);
      if (broken) throw new Error('Second page refused');
      return page([subscription(2)]);
    });
    const view = renderHook(() => useOfferingSubscriptions(offering.uuid), { wrapper });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.data).toBeUndefined();

    broken = false;
    await act(() => view.result.current.refetch());

    await waitFor(() => expect(view.result.current.data).toHaveLength(2));
  });

  it('reads the applications again when the offerings are refreshed', async () => {
    api.get.mockResolvedValue(page([subscription(1)]));
    const view = renderHook(() => useOfferingSubscriptions(offering.uuid), { wrapper });
    await waitFor(() => expect(view.result.current.data).toHaveLength(1));

    api.get.mockResolvedValue(page([subscription(1), subscription(2)]));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['offering-subscriptions'] });
    });

    await waitFor(() => expect(view.result.current.data).toHaveLength(2));
  });
});
