import { useId, useState } from 'react';
import { REGISTER_CLASS_TYPES, formatDateTime, type OrderSubmissionOwner, type useShareClass } from '@ledova/shared';
import { LoadError, Loading, MoreToggle, Row, Rows } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { useClassDetailsHistory } from './useClassDetailsHistory';

const fields = [
  ['name', 'Class name'],
  ['symbol', 'Class code'],
  ['tokenType', 'Class type'],
] as const;

export function ClassDetailsHistory({
  data,
  owner,
  available,
}: {
  data: ReturnType<typeof useShareClass>;
  owner: OrderSubmissionOwner;
  available: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const history = useClassDetailsHistory(data, owner, open && available);
  const value = (field: string, text: string) =>
    field === 'tokenType' ? (REGISTER_CLASS_TYPES.find(([type]) => type === text)?.[1] ?? text) : text;
  return (
    <>
      <MoreToggle open={open} controls={id} disabled={!available} onToggle={() => setOpen((shown) => !shown)}>
        {open ? 'Hide previous details' : 'Show previous details'}
      </MoreToggle>
      <div id={id} hidden={!open} className="space-y-3">
        {open &&
          (history.hasError ? (
            <LoadError retry={() => history.query.refetch()} busy={history.query.isFetching}>
              The class details history could not be loaded.
            </LoadError>
          ) : !history.ready ? (
            <Loading>Loading previous details…</Loading>
          ) : history.revisions.length ? (
            <>
              <ul className="divide-y divide-border-subtle">
                {history.revisions.map((revision) => (
                  <li key={revision.uuid} className="space-y-2 py-3">
                    <p className="text-sm font-medium">
                      {formatDateTime(revision.createdAt)} · {revision.recordedByName || 'Company representative'}
                    </p>
                    <Rows>
                      {fields
                        .filter(([field]) => revision.before[field] !== revision.after[field])
                        .map(([field, label]) => (
                          <Row key={field} label={label}>
                            {value(field, revision.before[field])} → {value(field, revision.after[field])}
                          </Row>
                        ))}
                    </Rows>
                  </li>
                ))}
              </ul>
              <LoadMore
                noun={['change', 'changes']}
                hasMore={history.query.hasNextPage}
                failed={history.query.isFetchNextPageError}
                loading={history.query.isFetchingNextPage}
                disabled={history.query.isFetching}
                onLoad={() => void history.query.fetchNextPage()}
              />
            </>
          ) : (
            <p className="text-sm text-text-muted">No changes recorded.</p>
          ))}
      </div>
    </>
  );
}
