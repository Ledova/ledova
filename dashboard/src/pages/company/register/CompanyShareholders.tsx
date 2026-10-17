import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_PARTICULARS_COPY,
  formatDate,
  formatShareCount,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';

type Holding = { register: TokenHoldersResponse; holder: TokenHoldersResponse['holders'][number] };
type Shareholder = { member: string; name: string; holdings: Holding[] };

function percentage(balance: string, supply: string | null) {
  if (supply === null || supply === '0') return 'Not recorded';
  const shares = BigInt(balance);
  const total = BigInt(supply);
  const rounded = (shares * 10000n + total / 2n) / total;
  return rounded === 0n && shares > 0n ? '<0.01%' : `${(Number(rounded) / 100).toFixed(2)}%`;
}

function needsIdentityReview({ holder }: Holding) {
  return holder.holderType === 'ambiguous' || holder.holderType === 'unidentified';
}

export function CompanyShareholders({
  registers,
  guardPreparation,
}: {
  registers: TokenHoldersResponse[];
  guardPreparation?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState(false);
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
  const selected = shareholders.find(({ member }) => member === selectedId);
  const unresolved = shareholders.filter(({ holdings }) => holdings.some(needsIdentityReview)).length;
  return (
    <>
      <Section title="Shareholders">
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
            {unresolved} {unresolved === 1 ? 'shareholder needs' : 'shareholders need'} identity review. Open Details
            for the affected holdings before relying on these records.
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
                    const holding = member.holdings.find(
                      ({ register: held }) => held.token.uuid === register.token.uuid,
                    );
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
                    <PageAction
                      label="Details"
                      context={member.name}
                      onClick={() => {
                        setSelectedId(member.member);
                        setNavigationError(false);
                      }}
                    />
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
      <Modal
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? 'Shareholder details'}
        size="2xl"
        showFooter
        cancelLabel="Close"
      >
        {selected && (
          <div className="space-y-5">
            {selected.holdings.map(({ register, holder }) => (
              <section key={register.token.uuid} className="space-y-3 rounded-xl border border-border-subtle p-4">
                <h3 className="break-words text-base font-medium text-text-primary">
                  {register.token.name} · {register.token.symbol}
                </h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {[
                    ['Shares held', formatShareCount(holder.balance)],
                    ['% of class', percentage(holder.balance, register.issuedSupply)],
                    ['Date added', formatDate(holder.enteredOn, 'Not recorded')],
                    ['Holder type', HOLDER_TYPE_LABELS[holder.holderType]],
                    ...(holder.name && holder.name !== selected.name ? [['Name for this class', holder.name]] : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-text-muted">{label}</dt>
                      <dd className="mt-1 break-words text-sm tabular-nums text-text-primary">{value}</dd>
                    </div>
                  ))}
                </dl>
                {holder.holderType === 'ambiguous' && (
                  <p className="text-sm text-text-muted">{REGISTER_COPY.AMBIGUOUS_NOTE}</p>
                )}
                {holder.holderType === 'unidentified' && (
                  <p className="text-sm text-text-muted">{REGISTER_COPY.UNIDENTIFIED_NOTE}</p>
                )}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-text-primary">Optional wallet links</h4>
                  {holder.wallets.length ? (
                    <ul className="space-y-2 text-sm text-text-muted">
                      {holder.wallets.map((wallet) => (
                        <li key={wallet.address} className="break-all">
                          {wallet.address} · {wallet.whitelistStatus}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-text-muted">{REGISTER_COPY.NO_WALLET}</p>
                  )}
                </div>
              </section>
            ))}
            {guardPreparation && (
              <Link
                to={DESTINATIONS.companyRegisterParticulars.path.replace(':member', selected.member)}
                className="inline-flex w-fit rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-text-primary hover:bg-surface-tertiary"
                onClick={(event) => {
                  try {
                    guardPreparation();
                  } catch {
                    event.preventDefault();
                    setNavigationError(true);
                  }
                }}
              >
                {REGISTER_PARTICULARS_COPY.PREPARE}
              </Link>
            )}
            {navigationError && (
              <p role="alert" className="text-sm text-error-light">
                Refresh the register and your current preparation appointment before changing particulars.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
