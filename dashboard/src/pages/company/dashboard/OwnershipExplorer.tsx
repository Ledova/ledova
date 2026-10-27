import { useEffect, useLayoutEffect, useRef } from 'react';
import { shareCount, sharePercentage, type ClassOwnershipHolders, type CompanyOwnershipSummary } from '@ledova/shared';
import { ListSearch, Pager } from '@components/List';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import type { ListParams } from '@hooks/useListParams';
import { OwnershipOverview } from './OwnershipOverview';
import { OwnershipHolders } from './OwnershipHolders';
import { ownershipColor } from './ownershipColors';

interface OwnershipExplorerProps {
  classes: CompanyOwnershipSummary['classes'];
  complete: boolean;
  issuedSupply: CompanyOwnershipSummary['issuedSupply'];
  selected: string | null;
  onSelect: (uuid: string | null) => void;
  holders: ClassOwnershipHolders | undefined;
  loading: boolean;
  error: unknown;
  retry: () => unknown;
  list: ListParams<string>;
}

export function OwnershipExplorer({
  classes,
  complete,
  issuedSupply,
  selected,
  onSelect,
  holders,
  loading,
  error,
  retry,
  list,
}: OwnershipExplorerProps) {
  const choice = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previous = useRef(selected);
  const current = classes.find(({ uuid }) => uuid === selected);
  const pending = loading || (!error && !holders);
  useLayoutEffect(() => {
    const region = content.current;
    if (!region || pending || error) return;
    const measure = () => {
      const height = region.getBoundingClientRect().height;
      if (height > 0) region.style.setProperty('--ownership-holders-height', `${height}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(region);
    return () => observer?.disconnect();
  }, [selected, holders, pending, error]);
  useEffect(() => {
    if (previous.current === selected) return;
    const returned = previous.current;
    previous.current = selected;
    if (selected) back.current?.focus();
    else {
      const rows = choice.current?.querySelectorAll<HTMLButtonElement>('button[data-class-uuid]');
      const target =
        Array.from(rows ?? []).find((row) => row.dataset.classUuid === returned) ??
        choice.current?.querySelector<HTMLInputElement>('input[type="search"]') ??
        rows?.[0];
      target?.focus();
    }
  }, [selected]);
  if (classes.length === 0)
    return (
      <Section title="Ownership overview">
        <p className="text-sm text-text-muted">No share classes yet.</p>
      </Section>
    );
  return (
    <Section title={current ? current.name : 'Ownership overview'}>
      {selected ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            {current && (
              <p className="min-w-0 break-words tabular-nums text-text-muted">
                <span className="break-all">{current.symbol}</span>
                {current.initialized && current.issuedSupply !== null && current.totalHolders !== null && (
                  <>
                    {' · '}
                    {shareCount(current.issuedSupply, 'issued')} · {current.totalHolders}{' '}
                    {current.totalHolders === 1 ? 'shareholder' : 'shareholders'}
                    {complete && issuedSupply !== null && issuedSupply !== '0' && (
                      <> · {sharePercentage(current.issuedSupply, issuedSupply)} of all issued shares</>
                    )}
                  </>
                )}
              </p>
            )}
            <PageAction ref={back} label="All classes" onClick={() => onSelect(null)} />
          </div>
          {!current ? (
            <p role="status" className="text-sm text-text-muted">
              This share class is no longer available in the company overview.
            </p>
          ) : !current.initialized || current.issuedSupply === null || current.totalHolders === null ? (
            <p role="status" className="text-sm text-text-muted">
              Current ownership is not available for this class. Its register must be opened and its figures confirmed.
            </p>
          ) : (
            <>
              <div className="w-full sm:max-w-sm">
                <ListSearch
                  label="Search shareholders"
                  list={list}
                  noun={['shareholder', 'shareholders']}
                  count={!loading && !error ? holders?.count : undefined}
                />
              </div>
              <div
                ref={content}
                aria-busy={pending}
                className="flex flex-col gap-4"
                style={pending ? { minHeight: 'var(--ownership-holders-height, 20rem)' } : undefined}
              >
                {loading ? (
                  <Loading>Loading shareholders…</Loading>
                ) : error ? (
                  <LoadError retry={retry}>The class’s shareholders could not be confirmed.</LoadError>
                ) : !holders ? (
                  <Loading>Loading shareholders…</Loading>
                ) : holders.count === 0 ? (
                  <p className="text-sm text-text-muted">
                    {list.search ? 'No shareholders match your search.' : 'No current shareholders yet.'}
                  </p>
                ) : (
                  <>
                    <OwnershipHolders
                      holders={holders}
                      name={current.name}
                      symbol={current.symbol}
                      color={ownershipColor(classes, current.uuid)}
                    />
                    <Pager
                      label="Class shareholders"
                      list={list}
                      noun={['shareholder', 'shareholders']}
                      count={holders.count}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <div ref={choice}>
          <OwnershipOverview
            classes={classes}
            complete={complete}
            issuedSupply={issuedSupply}
            onSelect={onSelect}
            list={list}
          />
        </div>
      )}
    </Section>
  );
}
