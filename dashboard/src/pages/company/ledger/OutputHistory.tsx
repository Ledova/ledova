import type { ReactNode } from 'react';
import { formatDate, formatDateTime, type OrderSubmissionOwner } from '@ledova/shared';
import { LoadError, Loading } from '@components/Ledger';
import { useCompanyPacks, useInspectionCopies } from './useOutputHistory';

function prepared(at: string, by: string) {
  return by ? `Prepared ${formatDateTime(at)} by ${by}` : `Prepared ${formatDateTime(at)}`;
}

function History<Row>({
  title,
  noun,
  query,
  render,
}: {
  title: string;
  noun: string;
  query: { data?: Row[]; isPending: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };
  render: (row: Row) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      {query.isPending ? (
        <Loading>Loading {noun}…</Loading>
      ) : query.isError ? (
        <LoadError retry={() => query.refetch()} busy={query.isFetching}>
          The {noun} could not be loaded.
        </LoadError>
      ) : query.data?.length ? (
        <ul className="divide-y divide-border-subtle">{query.data.map(render)}</ul>
      ) : (
        <p className="text-sm text-text-muted">None yet.</p>
      )}
    </div>
  );
}

export function InspectionCopyHistory({
  owner,
  token,
  guard,
}: {
  owner: OrderSubmissionOwner;
  token: string;
  guard: () => void;
}) {
  const copies = useInspectionCopies(owner, token, guard);
  return (
    <History
      title="Prepared copies"
      noun="prepared copies"
      query={copies}
      render={(copy) => (
        <li key={copy.uuid} className="flex flex-col gap-1 py-3 text-sm">
          <p className="font-medium text-text-primary">For {copy.recipient}</p>
          <p className="text-text-muted">
            Requested {formatDate(copy.requestedOn)}
            {copy.late ? ' · provided late' : ''} · {prepared(copy.preparedAt, copy.preparedByName)}
          </p>
          <p className="break-words text-text-muted">Instruction: {copy.instruction}</p>
        </li>
      )}
    />
  );
}

export function CompanyPackHistory({
  owner,
  company,
  guard,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  guard: () => void;
}) {
  const packs = useCompanyPacks(owner, company, guard);
  return (
    <History
      title="Prepared packs"
      noun="prepared packs"
      query={packs}
      render={(pack) => (
        <li key={pack.digest} className="flex flex-col gap-1 py-3 text-sm">
          <p className="font-medium text-text-primary">For {pack.recipient}</p>
          <p className="text-text-muted">
            {prepared(pack.preparedAt, pack.preparedByName)} · {pack.classes}{' '}
            {pack.classes === 1 ? 'share class' : 'share classes'}
          </p>
          <p className="break-words text-text-muted">Instruction: {pack.instruction}</p>
        </li>
      )}
    />
  );
}
