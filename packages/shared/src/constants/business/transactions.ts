import type { Transaction } from '../../types/domain/transaction';

interface TransactionStatusDisplay {
  label: string;
  mark?: '✓' | '✗';
  tone: 'success' | 'error' | 'warning' | 'info';
}

const transactionStatuses = new Map<string, TransactionStatusDisplay>(
  Object.entries({
    confirmed: { label: 'Confirmed', mark: '✓', tone: 'success' },
    pending: { label: 'Pending', tone: 'warning' },
    failed: { label: 'Failed', mark: '✗', tone: 'error' },
    replaced: { label: 'Replaced', tone: 'info' },
    reorged: { label: 'Confirmation reversed', tone: 'warning' },
  } satisfies Record<Transaction['status'], TransactionStatusDisplay>),
);

export function getTransactionStatus(status: string | null | undefined): TransactionStatusDisplay {
  return transactionStatuses.get(status ?? '') ?? { label: 'Unknown', tone: 'info' };
}
