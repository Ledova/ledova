import { formatShareCount } from './formatting';

export function marketQuantity(value: number): string {
  return Number.isSafeInteger(value) && value >= 0 ? formatShareCount(String(value)) : 'Unavailable';
}

export function priceCents(value: string): bigint | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
