import { getChainShortCode } from '../constants';

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

export function formatAmount(value: string | number | null | undefined, currency: string): string {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const figures = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${currency}\u00a0${figures}`;
}

export function formatCryptoBalance(balance: string | number, symbol: string, decimals: number = 8): string {
  const balanceNum = typeof balance === 'string' ? parseFloat(balance) : balance;
  if (balanceNum === 0) return `0 ${symbol}`;
  const formatted = balanceNum.toFixed(decimals).replace(/\.?0+$/, '');
  return `${formatted} ${symbol}`;
}

export function getBlockchainShortName(chainName: string): string {
  return getChainShortCode(chainName);
}

export function formatPercentage(value: number, decimals: number = 2): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}
