import { formatMoney, formatShareCount } from '@ledova/shared';

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
  return formatMoney(`${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`, 'AUD');
}
