import { formatShareCount, getNextPageParam } from '@ledova/shared';
import type { PaginatedResponse } from '@ledova/shared';

export async function allMarketPages<T>(
  read: (page?: number) => Promise<{ data: PaginatedResponse<T> }>,
): Promise<T[]> {
  const rows: T[] = [];
  let page: number | undefined;
  do {
    const { data } = await read(page);
    rows.push(...data.results);
    const next = getNextPageParam(data);
    if (data.next && (!next || !Number.isInteger(next) || next <= (page ?? 1))) {
      throw new Error('The next page could not be read.');
    }
    page = next;
  } while (page);
  return rows;
}

export function marketQuantity(value: number): string {
  return Number.isSafeInteger(value) && value >= 0 ? formatShareCount(String(value)) : 'Unavailable';
}

export function priceCents(value: string): bigint | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function marketAmount(price: string, quantity: number | bigint = 1): string {
  const cents = priceCents(price);
  if (cents === null || (typeof quantity === 'number' && !Number.isSafeInteger(quantity)) || quantity < 0)
    return 'Unavailable';
  const total = cents * BigInt(quantity);
  return `$${formatShareCount((total / 100n).toString())}.${(total % 100n).toString().padStart(2, '0')} AUD`;
}
