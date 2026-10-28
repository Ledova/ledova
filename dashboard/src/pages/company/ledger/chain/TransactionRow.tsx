import { getBlockExplorerTxUrl } from '@ledova/shared';
import { Row } from '@components/Ledger';

export function TransactionRow({ chain, hash }: { chain: string | undefined; hash: string }) {
  const url = chain ? getBlockExplorerTxUrl(chain, hash) : '';
  return (
    <Row label="Transaction">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-light underline">
          View transaction
        </a>
      ) : (
        <span className="break-all">{hash}</span>
      )}
    </Row>
  );
}
