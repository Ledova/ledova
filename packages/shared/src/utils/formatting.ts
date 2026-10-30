export const formatShareCount = (shares: string) => shares.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const shortReference = (uuid: string) => uuid.slice(0, 8);

export const shareChange = (shares: string) =>
  shares.startsWith('-') ? formatShareCount(shares) : `+${formatShareCount(shares)}`;

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

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function formatCryptoBalance(balance: string | number, symbol: string, decimals: number = 8): string {
  const decimal = typeof balance === 'string' ? DECIMAL.exec(balance) : null;
  if (!decimal) {
    const balanceNum = typeof balance === 'string' ? parseFloat(balance) : balance;
    if (balanceNum === 0) return `0 ${symbol}`;
    const formatted = balanceNum.toFixed(decimals).replace(/\.?0+$/, '');
    return `${formatted} ${symbol}`;
  }
  const [, sign = '', whole = '', fraction = ''] = decimal;
  const rounded =
    BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, '0')) + (fraction.charAt(decimals) >= '5' ? 1n : 0n);
  if (rounded === 0n) return `0 ${symbol}`;
  const digits = rounded.toString().padStart(decimals + 1, '0');
  const point = digits.length - decimals;
  const places = digits.slice(point).replace(/0+$/, '');
  return `${sign}${digits.slice(0, point)}${places ? `.${places}` : ''} ${symbol}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
