import type { ReactNode } from 'react';
import {
  companyPackFacts,
  inspectionCopyFacts,
  useCompanyPacks,
  useInspectionCopies,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { LoadError, Loading } from '@components/Ledger';

function History<Row>({
  title,
  noun,
  empty,
  query,
  render,
}: {
  title: string;
  noun: string;
  empty: string;
  query: { data?: Row[]; isPending: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };
  render: (row: Row) => ReactNode;
}) {
  return query.isPending ? (
    <Loading>Loading {noun}…</Loading>
  ) : query.isError ? (
    <LoadError retry={() => query.refetch()} busy={query.isFetching}>
      The {noun} could not be loaded.
    </LoadError>
  ) : query.data?.length ? (
    <ul aria-label={title} className="divide-y divide-border-subtle">
      {query.data.map(render)}
    </ul>
  ) : (
    <p className="text-sm text-text-muted">{empty}</p>
  );
}

export function InspectionCopyHistory({
  owner,
  token,
  guard,
  enabled,
}: {
  owner: OrderSubmissionOwner;
  token: string;
  guard: () => void;
  enabled: boolean;
}) {
  const copies = useInspectionCopies(owner, token, guard, enabled);
  return (
    <History
      title="Prepared copies"
      noun="prepared copies"
      empty="No inspection copies prepared yet."
      query={copies}
      render={(copy) => (
        <li key={copy.uuid} className="flex flex-col gap-1 py-3 text-sm">
          <p className="break-words font-medium text-text-primary">For {copy.recipient}</p>
          <p className="text-xs text-text-muted">{inspectionCopyFacts(copy)}</p>
          <p className="break-words text-xs text-text-muted">Instruction: {copy.instruction}</p>
        </li>
      )}
    />
  );
}

export function CompanyPackHistory({
  owner,
  company,
  guard,
  enabled,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  guard: () => void;
  enabled: boolean;
}) {
  const packs = useCompanyPacks(owner, company, guard, enabled);
  return (
    <History
      title="Prepared packs"
      noun="prepared packs"
      empty="No company packs prepared yet."
      query={packs}
      render={(pack) => (
        <li key={pack.digest} className="flex flex-col gap-1 py-3 text-sm">
          <p className="break-words font-medium text-text-primary">For {pack.recipient}</p>
          <p className="text-xs text-text-muted">{companyPackFacts(pack)}</p>
          <p className="break-words text-xs text-text-muted">Instruction: {pack.instruction}</p>
        </li>
      )}
    />
  );
}
