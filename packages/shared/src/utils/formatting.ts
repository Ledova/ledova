export const formatShareCount = (shares: string) => shares.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatMoney(amount: string, currency: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  return `${currency}\u00a0${formatShareCount(whole)}.${fraction.padEnd(2, '0')}`;
}

export const shortReference = (uuid: string) => uuid.slice(0, 8);

export const shareChange = (shares: string) =>
  shares.startsWith('-') ? formatShareCount(shares) : `+${formatShareCount(shares)}`;

export function signedShares(shares: bigint) {
  const size = formatShareCount((shares < 0n ? -shares : shares).toString());
  return shares < 0n ? `−${size}` : `+${size}`;
}

export function shareCount(shares: string | number, kind?: string) {
  const count = String(shares);
  return `${formatShareCount(count)} ${kind ? `${kind} ` : ''}${count === '1' ? 'share' : 'shares'}`;
}

export function sharePercentage(shares: string, total: string | null) {
  if (total === null || total === '0') return 'Not recorded';
  const part = BigInt(shares);
  const whole = BigInt(total);
  const rounded = (part * 10000n + whole / 2n) / whole;
  return rounded === 0n && part > 0n ? '<0.01%' : `${(Number(rounded) / 100).toFixed(2)}%`;
}
