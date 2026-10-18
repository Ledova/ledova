export function applicationAmount(quantity: string, price: string) {
  if (!/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || !/^\d+(\.\d{1,2})?$/.test(price))
    return null;
  const [whole, fraction = ''] = price.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n) return null;
  const total = BigInt(quantity) * cents;
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
