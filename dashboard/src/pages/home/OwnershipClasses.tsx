import { useId, useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import { formatShareCount, searchRows, sharePercentage } from '@ledova/shared';
import { ListSearch, Pager } from '@components/List';
import { OwnershipRing } from './OwnershipRing';
import { ownershipColor } from './ownershipColors';
import { PAGE_SIZE, type ListParams } from '@hooks/useListParams';
import type { OwnershipClass } from './ownershipView';

export function OwnershipClasses({
  classes,
  total,
  complete,
  personalOnly,
  hasMember,
  selected,
  onSelect,
  list,
}: {
  classes: OwnershipClass[];
  total: string | null;
  complete: boolean;
  personalOnly: boolean;
  hasMember: boolean;
  selected: string | null;
  onSelect: (uuid: string) => void;
  list: ListParams<string>;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const highlighted = hovered ?? focused ?? selected;
  const ranked = [...classes].sort((left, right) => {
    const delta = BigInt(right.issuedSupply ?? '0') - BigInt(left.issuedSupply ?? '0');
    return delta > 0n ? 1 : delta < 0n ? -1 : left.name.localeCompare(right.name);
  });
  const found = searchRows(ranked, (row) => `${row.name} ${row.symbol}`, selected ? '' : list.search);
  const page = selected
    ? Math.max(1, Math.floor(found.findIndex(({ uuid }) => uuid === selected) / PAGE_SIZE) + 1)
    : Math.min(list.page, Math.max(1, Math.ceil(found.length / PAGE_SIZE)));
  const shown = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasRing = complete && total !== null && total !== '0';
  return (
    <>
      <p className="text-sm text-text-muted">
        {personalOnly ? 'Your issued shares by class' : 'Company ownership by issued share count'}
      </p>
      {!complete && (
        <p role="status" className="text-sm text-text-muted">
          {classes.length
            ? 'Company totals are incomplete until every class has an opened ledger.'
            : 'Set up the ledger to record company ownership.'}
        </p>
      )}
      {total === '0' && <p className="text-sm text-text-muted">No issued shares yet.</p>}
      <div className={hasRing ? 'grid min-w-0 gap-4 md:grid-cols-2 md:items-start' : 'min-w-0'}>
        {hasRing && (
          <OwnershipRing
            classes={classes}
            issuedSupply={total}
            highlighted={highlighted}
            onHighlight={setHovered}
            onSelect={onSelect}
          />
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {classes.length > 10 && !selected && (
            <ListSearch
              label="Search share classes"
              list={list}
              noun={['share class', 'share classes']}
              count={found.length}
            />
          )}
          <ul aria-label="Share classes" className="divide-y divide-border-subtle">
            {shown.map((row) => (
              <li key={row.uuid}>
                <button
                  type="button"
                  data-class-uuid={row.uuid}
                  aria-label={`Explore ${row.name} (${row.symbol})`}
                  aria-pressed={row.uuid === selected}
                  aria-describedby={`${id}-${row.uuid}`}
                  onClick={() => onSelect(row.uuid)}
                  onMouseEnter={() => setHovered(row.uuid)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setFocused(row.uuid)}
                  onBlur={() => setFocused(null)}
                  className={`group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm hover:bg-surface-tertiary focus-visible:bg-surface-tertiary ${highlighted === row.uuid ? 'bg-surface-tertiary' : ''}`}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: ownershipColor(classes, row.uuid) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-text-primary">{row.name}</span>
                    <span className="block break-all text-xs text-text-muted">{row.symbol}</span>
                  </span>
                  <span id={`${id}-${row.uuid}`} className="min-w-0 text-right tabular-nums">
                    <span className="block break-all text-text-primary">
                      {row.issuedSupply === null ? 'Not recorded' : formatShareCount(row.issuedSupply)}
                      <span className="sr-only"> {personalOnly ? 'held by you' : 'issued shares'}</span>
                    </span>
                    {hasRing && row.issuedSupply !== null && (
                      <span className="block text-xs text-text-muted">
                        {sharePercentage(row.issuedSupply, total)}
                        <span className="sr-only">
                          {' '}
                          {personalOnly ? 'of your shares in this company' : 'of company issued shares'}
                        </span>
                      </span>
                    )}
                    {!personalOnly && hasMember && row.ownShares !== null && (
                      <span className="block text-xs text-text-muted">You: {formatShareCount(row.ownShares)}</span>
                    )}
                  </span>
                  <CaretRightIcon aria-hidden className="h-4 w-4 shrink-0 text-text-muted" />
                </button>
              </li>
            ))}
          </ul>
          {found.length === 0 && (
            <p className="text-sm text-text-muted">
              {classes.length === 0 ? 'No share classes yet.' : 'No share classes match your search.'}
            </p>
          )}
          {classes.length > PAGE_SIZE && !selected && (
            <Pager label="Share classes" list={list} noun={['share class', 'share classes']} count={found.length} />
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">
        {personalOnly
          ? 'Company ownership is unavailable. This ring shows your issued shares.'
          : 'Share counts show composition, not voting power or value.'}
      </p>
    </>
  );
}
