import type { PaginatedResponse } from '../types';

export const getNextPageParam = <T>(lastPage: PaginatedResponse<T> | undefined): number | undefined => {
  if (!lastPage?.next) return undefined;
  const page = new URL(lastPage.next).searchParams.get('page');
  return page ? Number(page) : undefined;
};

export const assertNextPageAdvances = (page: number, data: PaginatedResponse<unknown>): void => {
  const next = getNextPageParam(data);
  if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
    throw new Error('Pagination did not advance');
  }
};

export async function readEveryPage<T>(read: (page: number) => Promise<{ data: PaginatedResponse<T> }>): Promise<T[]> {
  const items: T[] = [];
  let page: number | undefined = 1;
  while (page !== undefined) {
    const { data } = await read(page);
    items.push(...data.results);
    assertNextPageAdvances(page, data);
    page = getNextPageParam(data);
  }
  return items;
}
