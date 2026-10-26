import { useEffect, useRef } from 'react';
import {
  formatShareCount,
  shareCount,
  sharePercentage,
  type ClassOwnershipHolders,
  type CompanyOwnershipSummary,
} from '@ledova/shared';
import { ListSearch, Pager, Table } from '@components/List';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { SelectField } from '@components/SelectField';
import type { ListParams } from '@hooks/useListParams';
import { OwnershipMap } from './OwnershipMap';

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
  const previous = useRef(selected);
  const current = classes.find(({ uuid }) => uuid === selected);
  useEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    if (selected) back.current?.focus();
    else choice.current?.querySelector('select')?.focus();
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
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <PageAction ref={back} label="All classes" onClick={() => onSelect(null)} />
            {current && <span className="text-text-muted">{current.symbol}</span>}
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
              <p className="text-sm tabular-nums text-text-muted">
                {shareCount(current.issuedSupply, 'issued')} · {current.totalHolders}{' '}
                {current.totalHolders === 1 ? 'shareholder' : 'shareholders'}
                {complete && issuedSupply !== null && issuedSupply !== '0' && (
                  <> · {sharePercentage(current.issuedSupply, issuedSupply)} of all issued shares</>
                )}
              </p>
              <ListSearch
                label="Search shareholders"
                list={list}
                noun={['shareholder', 'shareholders']}
                count={!loading && !error ? holders?.count : undefined}
              />
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
                  <Table
                    caption={`${current.name} shareholders`}
                    columns={[
                      { label: 'Shareholder' },
                      { label: 'Shares', align: 'right' },
                      { label: `% of ${current.symbol}`, align: 'right' },
                    ]}
                  >
                    {holders.results.map((holder) => (
                      <tr key={holder.member}>
                        <th scope="row" className="min-w-48 px-4 py-3 text-left font-medium text-text-primary">
                          <span className="block break-words">{holder.name || 'Unnamed shareholder'}</span>
                          <span aria-hidden="true" className="mt-2 block h-1.5 w-full max-w-56 bg-surface-tertiary">
                            <span
                              className="block h-full bg-brand-light"
                              style={{
                                width:
                                  holders.issuedSupply === '0'
                                    ? '0%'
                                    : `${Number((BigInt(holder.balance) * 10000n) / BigInt(holders.issuedSupply)) / 100}%`,
                              }}
                            />
                          </span>
                        </th>
                        <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                          {formatShareCount(holder.balance)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                          {sharePercentage(holder.balance, holders.issuedSupply)}
                        </td>
                      </tr>
                    ))}
                  </Table>
                  <Pager
                    label="Class shareholders"
                    list={list}
                    noun={['shareholder', 'shareholders']}
                    count={holders.count}
                  />
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="text-sm text-text-muted">By issued share count</p>
            <div ref={choice} className="w-full sm:w-80">
              <SelectField
                label="Explore a class"
                value=""
                onChange={(uuid) => onSelect(uuid || null)}
                options={[
                  { value: '', label: 'All classes' },
                  ...classes.map((item) => ({
                    value: item.uuid,
                    label: `${item.name} · ${item.symbol} · ${item.issuedSupply !== null ? shareCount(item.issuedSupply) : 'Not recorded'}`,
                  })),
                ]}
              />
            </div>
          </div>
          {!complete || issuedSupply === null ? (
            <p role="status" className="text-sm text-text-muted">
              The ownership map is unavailable until every class has an opened register and confirmed figures.
            </p>
          ) : issuedSupply === '0' ? (
            <p className="text-sm text-text-muted">No issued shares yet.</p>
          ) : (
            <OwnershipMap classes={classes} issuedSupply={issuedSupply} onSelect={onSelect} />
          )}
          <div className={complete && issuedSupply !== null && issuedSupply !== '0' ? 'md:hidden' : ''}>
            <Table
              caption="Company share classes"
              columns={[
                { label: 'Share class' },
                { label: 'Issued shares', align: 'right' },
                ...(complete && issuedSupply !== null && issuedSupply !== '0'
                  ? [{ label: '% issued', align: 'right' as const }]
                  : []),
              ]}
            >
              {classes.map((item) => (
                <tr key={item.uuid}>
                  <th scope="row" className="min-w-40 px-4 py-3 text-left font-normal">
                    <button
                      type="button"
                      className="text-left text-brand-light underline underline-offset-4"
                      onClick={() => onSelect(item.uuid)}
                    >
                      <span className="block font-medium">{item.symbol}</span>
                      <span className="block break-words text-sm">{item.name}</span>
                    </button>
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.issuedSupply === null ? 'Not recorded' : formatShareCount(item.issuedSupply)}
                  </td>
                  {complete && issuedSupply !== null && issuedSupply !== '0' && (
                    <td className="px-4 py-3 text-right tabular-nums">
                      {sharePercentage(item.issuedSupply!, issuedSupply)}
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          </div>
          <p className="text-xs text-text-muted">Share counts show composition, not voting power or value.</p>
        </>
      )}
    </Section>
  );
}
