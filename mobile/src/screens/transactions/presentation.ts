import { formatShareCount, getTransactionStatus } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';

export function activityAmount(amount: string | null, symbol: string) {
  if (amount === null || !/^-?\d+(\.\d+)?$/.test(amount)) return 'Unavailable';
  const sign = amount.startsWith('-') ? '-' : '';
  const [whole, fractional = ''] = amount.replace(/^-/, '').split('.');
  const fraction = fractional.replace(/0+$/, '');
  return `${sign}${formatShareCount(whole)}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`;
}

export function activityDirection(transaction: Transaction) {
  const normalize = (value: string | null) => {
    if (!value) return '';
    if (transaction.chain === 'bitcoin') return /^(bc|tb|bcrt)1/i.test(value) ? value.toLowerCase() : value;
    return transaction.chain === 'solana' ? value : value.toLowerCase();
  };
  const wallet = normalize(transaction.walletAddress);
  if (!wallet) return 'Direction unavailable';
  const incoming = normalize(transaction.toAddress) === wallet;
  const outgoing = normalize(transaction.fromAddress) === wallet;
  if (incoming && outgoing) return 'Self transfer';
  if (incoming) return 'Incoming';
  if (outgoing) return 'Outgoing';
  return 'Direction unavailable';
}

export function activityState(transaction: Transaction) {
  const { label, mark } = getTransactionStatus(transaction.status);
  return { label, text: mark ? `${mark} ${label}` : label };
}

export function feeUnit(chain: Transaction['chain']) {
  if (chain === 'base' || chain === 'ethereum' || chain === 'arbitrum' || chain === 'optimism') return 'ETH';
  if (chain === 'bitcoin') return 'BTC';
  return 'native units';
}
