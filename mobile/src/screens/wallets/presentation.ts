export function compareWalletDecimals(left: string, right: string) {
  const decimal = (value: string) => (/^-?\d+(\.\d+)?$/.test(value) ? value : '0');
  const a = decimal(left);
  const b = decimal(right);
  const places = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const magnitude = BigInt(whole + fraction.padEnd(places, '0'));
    return negative ? -magnitude : magnitude;
  };
  const x = integer(a);
  const y = integer(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
