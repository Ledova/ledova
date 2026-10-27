import { useId, useState } from 'react';
import { formatShareCount, searchRows, sharePercentage, type CompanyOwnershipSummary } from '@ledova/shared';
import { ListSearch, Pager } from '@components/List';
import { PAGE_SIZE, type ListParams } from '@hooks/useListParams';
import { OwnershipRing } from './OwnershipRing';
import { ownershipColor } from './ownershipColors';

interface OwnershipOverviewProps {
  classes: CompanyOwnershipSummary['classes'];
  complete: boolean;
  issuedSupply: string | null;
  onSelect: (uuid: string) => void;
  list: ListParams<string>;
}

export function OwnershipOverview({ classes, complete, issuedSupply, onSelect, list }: OwnershipOverviewProps) {
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const highlighted = hovered ?? focused;
  const ranked = [...classes].sort((left, right) => {
    const difference = BigInt(right.issuedSupply ?? '0') - BigInt(left.issuedSupply ?? '0');
    return difference > 0n ? 1 : difference < 0n ? -1 : left.name.localeCompare(right.name);
  });
  const found = searchRows(ranked, (row) => `${row.name} ${row.symbol}`, list.search);
  const page = Math.min(list.page, Math.max(1, Math.ceil(found.length / PAGE_SIZE)));
  const shown = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasRing = complete && issuedSupply !== null && issuedSupply !== '0';
  const searchable = classes.length > 10 || !!list.typed || !!list.search;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">By issued share count</p>
      {!complete || issuedSupply === null ? (
        <p role="status" className="text-sm text-text-muted">
          The ownership ring is unavailable until every class has an opened register and confirmed figures.
        </p>
      ) : issuedSupply === '0' ? (
        <p className="text-sm text-text-muted">No issued shares yet.</p>
      ) : null}
      <div className={hasRing ? 'grid min-w-0 gap-6 md:grid-cols-2 md:items-start' : 'min-w-0'}>
        {hasRing && (
          <OwnershipRing
            classes={classes}
            issuedSupply={issuedSupply!}
            onSelect={onSelect}
            highlighted={highlighted}
            onHighlight={setHovered}
          />
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {searchable && (
            <ListSearch
              label="Search share classes"
              list={list}
              noun={['share class', 'share classes']}
              count={found.length}
            />
          )}
          {shown.length === 0 ? (
            <p className="text-sm text-text-muted">No share classes match your search.</p>
          ) : (
            <ul aria-label="Share classes" className="divide-y divide-border-subtle">
              {shown.map((row) => (
                <li key={row.uuid}>
                  <button
                    type="button"
                    data-class-uuid={row.uuid}
                    aria-label={`Explore ${row.name} (${row.symbol})`}
                    aria-describedby={`${id}-${row.uuid}`}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-surface-tertiary focus-visible:bg-surface-tertiary motion-safe:transition-colors motion-safe:duration-150 ${highlighted === row.uuid ? 'bg-surface-tertiary' : ''}`}
                    onMouseEnter={() => setHovered(row.uuid)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setFocused(row.uuid)}
                    onBlur={() => setFocused(null)}
                    onClick={() => onSelect(row.uuid)}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: ownershipColor(classes, row.uuid) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium text-text-primary">{row.name}</span>
                      <span className="block break-all text-text-muted">{row.symbol}</span>
                    </span>
                    <span id={`${id}-${row.uuid}`} className="shrink-0 text-right tabular-nums">
                      <span className="block text-text-primary">
                        {row.issuedSupply === null ? 'Not recorded' : formatShareCount(row.issuedSupply)}
                        {row.issuedSupply !== null && <span className="sr-only"> issued shares</span>}
                      </span>
                      {hasRing && row.issuedSupply !== null && (
                        <span className="block text-text-muted">
                          {sharePercentage(row.issuedSupply, issuedSupply!)}
                          <span className="sr-only"> of issued shares</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {classes.length > PAGE_SIZE && (
            <Pager label="Share classes" list={list} noun={['share class', 'share classes']} count={found.length} />
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">Share counts show composition, not voting power or value.</p>
    </div>
  );
}
