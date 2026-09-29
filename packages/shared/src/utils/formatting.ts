export interface FormatCurrencyOptions {
  currency?: string;
  locale?: string;
  decimals?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export function formatCurrency(value?: number, options: FormatCurrencyOptions = {}): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  const {
    currency = 'AUD',
    locale = 'en-AU',
    decimals = 2,
    minimumFractionDigits = decimals,
    maximumFractionDigits = decimals,
  } = options;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
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
