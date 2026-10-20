import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HOLDER_TYPE_LABELS, formatShareCount, type TokenHoldersResponse } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { percentage, shareholderPath } from './shareholders';

type Holding = { register: TokenHoldersResponse; holder: TokenHoldersResponse['holders'][number] };
type Shareholder = { member: string; name: string; holdings: Holding[] };

function needsIdentityReview({ holder }: Pick<Holding, 'holder'>) {
  return holder.holderType === 'ambiguous' || holder.holderType === 'unidentified';
}

export function CompanyShareholders({ registers, company }: { registers: TokenHoldersResponse[]; company: string }) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [page, setPage] = useState(0);
  const grouped = new Map<string, Shareholder>();
  for (const register of registers) {
    for (const holder of register.holders) {
      const existing = grouped.get(holder.member);
      const holding = { register, holder };
      if (existing) existing.holdings.push(holding);
      else
        grouped.set(holder.member, {
          member: holder.member,
          name: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
          holdings: [holding],
        });
    }
  }
  const shareholders = [...grouped.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.member.localeCompare(right.member),
  );
  const term = search.trim().toLocaleLowerCase();
  const filtered = shareholders.filter(
    (member) =>
      (member.name.toLocaleLowerCase().includes(term) ||
        member.holdings.some(({ holder }) => holder.name?.toLocaleLowerCase().includes(term))) &&
      (classFilter === 'all' || member.holdings.some(({ register }) => register.token.uuid === classFilter)),
  );
  const visibleClasses =
    classFilter === 'all' ? registers : registers.filter(({ token }) => token.uuid === classFilter);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * 10;
  const unresolved = shareholders.filter(({ holdings }) => holdings.some(needsIdentityReview)).length;
  return (
    <Section title="Current shareholders">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <label className={LABEL}>
          Search shareholders
          <input
            type="search"
            value={search}
            placeholder="Name"
            maxLength={100}
            className={FIELD_CLASS}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className={LABEL}>
          Share class
          <select
            value={classFilter}
            className={FIELD_CLASS}
            onChange={(event) => {
              setClassFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All classes</option>
            {registers.map(({ token }) => (
              <option key={token.uuid} value={token.uuid}>
                {token.name} · {token.symbol}
              </option>
            ))}
          </select>
        </label>
      </div>
      {registers.some(({ initialized }) => !initialized) && (
        <p role="status" className="text-sm text-text-muted">
          Unopened classes have no recorded holdings. This list includes only the opened registers.
        </p>
      )}
      {unresolved > 0 && (
        <p role="status" className="text-sm text-text-muted">
          {unresolved} {unresolved === 1 ? 'shareholder needs' : 'shareholders need'} identity review. Open their
          details before relying on these records.
        </p>
      )}
      <div className="relative max-w-full overflow-x-auto rounded-xl border border-border-subtle">
        <table
          className="w-full table-fixed text-left text-sm"
          style={{ minWidth: visibleClasses.length > 2 ? `${240 + visibleClasses.length * 112}px` : undefined }}
        >
          <caption className="sr-only">Company shareholders</caption>
          <colgroup>
            <col />
            {visibleClasses.map(({ token }) => (
              <col key={token.uuid} className="w-14 sm:w-28" />
            ))}
            <col className="w-20 sm:w-24" />
          </colgroup>
          <thead className="bg-surface-tertiary text-xs text-text-muted">
            <tr>
              <th scope="col" className="break-words px-3 py-3 font-medium sm:px-4">
                Shareholder
              </th>
              {visibleClasses.map(({ token }) => (
                <th key={token.uuid} scope="col" className="break-words px-1 py-3 text-right font-medium sm:px-3">
                  <span>{token.symbol}</span>
                  <span className="sr-only"> shares and percentage of {token.name}</span>
                </th>
              ))}
              <th scope="col" className="px-1 py-3 sm:px-3">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {filtered.slice(start, start + 10).map((member) => (
              <tr key={member.member}>
                <th scope="row" className="break-words px-3 py-3 text-left font-normal sm:px-4">
                  <p className="font-medium text-text-primary">{member.name}</p>
                  {member.holdings.some(needsIdentityReview) && (
                    <p className="mt-1 text-xs text-text-muted">Identity needs review</p>
                  )}
                </th>
                {visibleClasses.map((register) => {
                  const holding = member.holdings.find(({ register: held }) => held.token.uuid === register.token.uuid);
                  return (
                    <td
                      key={register.token.uuid}
                      className="break-all px-1 py-3 text-right tabular-nums text-text-primary sm:px-3"
                    >
                      {!register.initialized ? (
                        <span className="text-xs text-text-muted">Not opened</span>
                      ) : holding ? (
                        <>
                          {formatShareCount(holding.holder.balance)}
                          <span className="mt-1 block break-normal text-xs text-text-muted">
                            {percentage(holding.holder.balance, register.issuedSupply)}
                          </span>
                        </>
                      ) : (
                        <span aria-label={`No ${register.token.symbol} holding`}>—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-1 py-3 sm:px-3">
                  <Link
                    to={shareholderPath(member.member, company)}
                    className="relative inline-flex w-fit items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary"
                  >
                    <span>Details</span> <span className="sr-only">({member.name})</span>
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleClasses.length + 2} className="px-4 py-10 text-center text-sm text-text-muted">
                  {shareholders.length ? 'No shareholders found.' : 'No current shareholders are recorded.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-text-muted">
          {filtered.length === 1
            ? '1 shareholder'
            : filtered.length
              ? `${start + 1}–${Math.min(start + 10, filtered.length)} of ${filtered.length} shareholders`
              : '0 shareholders'}
        </p>
        {pages > 1 && (
          <nav aria-label="Shareholder pages" className="ml-auto flex flex-wrap items-center gap-2">
            <PageAction label="Previous" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} />
            <span className="text-sm tabular-nums text-text-muted">
              {currentPage + 1} / {pages}
            </span>
            <PageAction label="Next" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} />
          </nav>
        )}
      </div>
    </Section>
  );
}
