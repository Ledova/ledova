import { useId, useState } from 'react';
import { formatShareCount, searchRows, sharePercentage } from '@ledova/shared';
import { ListSearch, Pager } from '@components/List';
import { OwnershipMetrics } from '@components/ownership/OwnershipMetrics';
import { OwnershipRing } from '@components/ownership/OwnershipRing';
import { ownershipColor } from '@components/ownership/ownershipColors';
import { PAGE_SIZE, useListParams } from '@hooks/useListParams';
import type { SharedOwnership } from './memberOwnership';

export function MemberCompanyOwnership({ ownership }: { ownership: SharedOwnership }) {
  const id = useId();
  const list = useListParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const highlighted = hovered ?? focused ?? selected;
  const select = (uuid: string) => {
    setSelected((previous) => (previous === uuid ? null : uuid));
    const position = found.findIndex((row) => row.uuid === uuid);
    if (position >= 0) list.setPage(Math.floor(position / PAGE_SIZE) + 1);
    else {
      list.clear();
      list.setPage(Math.floor(ranked.findIndex((row) => row.uuid === uuid) / PAGE_SIZE) + 1);
    }
  };
  const ranked = [...ownership.classes].sort((left, right) => {
    const difference = BigInt(right.issuedSupply ?? '0') - BigInt(left.issuedSupply ?? '0');
    return difference > 0n ? 1 : difference < 0n ? -1 : left.name.localeCompare(right.name);
  });
  const found = searchRows(ranked, (row) => `${row.name} ${row.symbol}`, list.search);
  const page = Math.min(list.page, Math.max(1, Math.ceil(found.length / PAGE_SIZE)));
  const shown = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasRing = ownership.complete && ownership.issuedSupply !== null && ownership.issuedSupply !== '0';
  const searchable = ownership.classes.length > 10 || !!list.typed || !!list.search;
  return (
    <>
      <OwnershipMetrics summary={ownership} embedded />
      <p className="text-sm text-text-muted">By issued share count</p>
      {!ownership.complete ? (
        <p role="status" className="text-sm text-text-muted">
          Company ownership is incomplete until every class has an opened register and confirmed figures.
        </p>
      ) : ownership.issuedSupply === '0' ? (
        <p className="text-sm text-text-muted">No issued shares yet.</p>
      ) : null}
      <div className={hasRing ? 'grid min-w-0 gap-6 md:grid-cols-2 md:items-start' : 'min-w-0'}>
        {hasRing && (
          <OwnershipRing
            classes={ownership.classes}
            issuedSupply={ownership.issuedSupply!}
            highlighted={highlighted}
            onHighlight={setHovered}
            onSelect={select}
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
            <>
              <div
                aria-hidden="true"
                className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] gap-3 px-3 text-xs text-text-muted"
              >
                <span>Share class</span>
                <span className="text-right">Issued shares</span>
                <span className="text-right">Your shares</span>
              </div>
              <ul aria-label="Company share classes" className="divide-y divide-border-subtle">
                {shown.map((row) => (
                  <li key={row.uuid}>
                    <button
                      type="button"
                      aria-label={`Highlight ${row.name} (${row.symbol})`}
                      aria-pressed={selected === row.uuid}
                      aria-describedby={`${id}-${row.uuid} ${id}-${row.uuid}-own`}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-surface-tertiary focus-visible:bg-surface-tertiary motion-safe:transition-colors motion-safe:duration-150 ${highlighted === row.uuid ? 'bg-surface-tertiary' : ''}`}
                      onMouseEnter={() => setHovered(row.uuid)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setFocused(row.uuid)}
                      onBlur={() => setFocused(null)}
                      onClick={() => select(row.uuid)}
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ownershipColor(ownership.classes, row.uuid) }}
                        />
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-text-primary">{row.name}</span>
                          <span className="block break-all text-text-muted">{row.symbol}</span>
                        </span>
                      </span>
                      <span id={`${id}-${row.uuid}`} className="text-right tabular-nums">
                        <span className="block break-all text-text-primary">
                          {row.issuedSupply === null ? 'Unavailable' : formatShareCount(row.issuedSupply)}
                          <span className="sr-only"> issued shares</span>
                        </span>
                        {hasRing && row.issuedSupply !== null && (
                          <span className="block text-xs text-text-muted">
                            {sharePercentage(row.issuedSupply, ownership.issuedSupply!)}
                            <span className="sr-only"> of company issued shares</span>
                          </span>
                        )}
                      </span>
                      <span id={`${id}-${row.uuid}-own`} className="text-right tabular-nums">
                        <span className="block break-all font-medium text-text-primary">
                          {row.ownShares === null ? 'Unavailable' : formatShareCount(row.ownShares)}
                          <span className="sr-only"> held by you</span>
                        </span>
                        {row.ownShares !== null && row.issuedSupply !== null && row.issuedSupply !== '0' && (
                          <span className="block text-xs text-text-muted">
                            {sharePercentage(row.ownShares, row.issuedSupply)} of class
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {ownership.classes.length > PAGE_SIZE && (
            <Pager label="Share classes" list={list} noun={['share class', 'share classes']} count={found.length} />
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">Share counts show composition, not voting power or value.</p>
    </>
  );
}
