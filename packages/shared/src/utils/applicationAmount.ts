import { priceCents } from './market-data';

export function applicationAmount(quantity: string, price: string) {
  if (!/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) return null;
  const cents = priceCents(price);
  if (cents === null || cents <= 0n) return null;
  const total = BigInt(quantity) * cents;
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
