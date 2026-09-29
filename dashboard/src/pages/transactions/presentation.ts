import { formatShareCount, getTransactionStatus } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

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
  const state = getTransactionStatus(transaction.status);
  const tones: Record<typeof state.tone, Tone> = {
    success: 'done',
    error: 'closed',
    warning: 'moving',
    info: 'waiting',
  };
  return { label: state.label, mark: state.mark, tone: tones[state.tone] };
}

export function feeUnit(chain: Transaction['chain']) {
  if (chain === 'base' || chain === 'ethereum' || chain === 'arbitrum' || chain === 'optimism') return 'ETH';
  if (chain === 'bitcoin') return 'BTC';
  return 'native units';
}
