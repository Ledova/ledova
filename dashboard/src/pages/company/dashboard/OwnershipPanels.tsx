import { Link } from 'react-router-dom';
import { DESTINATIONS, HOLDER_TYPE_LABELS, formatShareCount, type TokenHoldersResponse } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { FIELD_CLASS } from '@components/fieldClass';
import { countBarWidth, ownershipSummary } from './summary';

export function OwnershipMetrics({ summary }: { summary: ReturnType<typeof ownershipSummary> }) {
  return (
    <section
      aria-label="Company ownership summary"
      className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5"
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
        {[
          ['Issued shares', summary.issued === null ? 'Not complete' : formatShareCount(summary.issued)],
          ['Current shareholders', summary.shareholders === null ? 'Not complete' : String(summary.shareholders)],
          ['Share classes', String(summary.classes)],
        ].map(([label, value], index) => (
          <div key={label} className={`min-w-0 ${index === 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="mt-1 break-words text-2xl font-medium tabular-nums text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.unopened > 0 && (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {summary.unopened} {summary.unopened === 1 ? 'class has' : 'classes have'} no opened register. Company totals
          are not complete.
        </p>
      )}
    </section>
  );
}

export function ShareholderPanel({
  company,
  registers,
  selected,
  select,
}: {
  company: string;
  registers: TokenHoldersResponse[];
  selected: TokenHoldersResponse;
  select: (uuid: string) => void;
}) {
  const holders = [...selected.holders]
    .sort((left, right) => {
      const difference = BigInt(right.balance) - BigInt(left.balance);
      return difference === 0n ? left.member.localeCompare(right.member) : difference > 0n ? 1 : -1;
    })
    .slice(0, 5);
  return (
    <Section title="Share ownership">
      {registers.length > 1 ? (
        <label className="mb-2 block space-y-1 text-sm text-text-primary">
          Share class
          <select className={FIELD_CLASS} value={selected.token.uuid} onChange={(event) => select(event.target.value)}>
            {registers.map(({ token }) => (
              <option key={token.uuid} value={token.uuid}>
                {token.name} · {token.symbol}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-text-muted">
          {selected.token.name} · {selected.token.symbol}
        </p>
      )}
      {!selected.initialized ? (
        <p className="py-4 text-sm text-text-muted">
          This share class has no opened register. Issued shares are not recorded.
        </p>
      ) : holders.length === 0 ? (
        <p className="py-4 text-sm text-text-muted">
          No issued shares or current shareholders are recorded for this class.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            {formatShareCount(selected.issuedSupply!)} issued shares · Percentages of this class&apos;s issued shares
          </p>
          <table className="mt-2 w-full table-fixed text-sm">
            <caption className="sr-only">Largest shareholders in {selected.token.name}</caption>
            <thead className="text-text-muted">
              <tr className="border-b border-border-subtle">
                <th scope="col" className="w-1/2 py-2 text-left font-normal">
                  Shareholder
                </th>
                <th scope="col" className="w-[30%] px-2 py-2 text-right font-normal">
                  Shares
                </th>
                <th scope="col" className="w-[20%] py-2 text-right font-normal">
                  % of class
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {holders.map((holder) => (
                <tr key={holder.member}>
                  <th scope="row" className="min-w-0 py-3 pr-3 text-left font-medium text-text-primary">
                    <span className="break-words">{holder.name || HOLDER_TYPE_LABELS[holder.holderType]}</span>
                    <span
                      aria-hidden="true"
                      className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
                    >
                      <span
                        className="block h-full rounded-full bg-brand-mid"
                        style={{ width: `${holder.percentage}%` }}
                      />
                    </span>
                  </th>
                  <td className="break-all px-2 py-3 text-right tabular-nums text-text-primary">
                    {formatShareCount(holder.balance)}
                  </td>
                  <td className="break-words py-3 text-right tabular-nums text-text-primary">
                    {holder.percentage.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.holders.length > holders.length && (
            <p className="text-sm text-text-muted">
              Showing the five largest shareholders. The register lists every member.
            </p>
          )}
        </>
      )}
      <Link
        to={DESTINATIONS.companyRegister.path}
        state={{ registerCompany: company, registerToken: selected.token.uuid }}
        className="mt-2 w-fit text-sm font-medium text-brand-light hover:underline"
      >
        View full register
      </Link>
    </Section>
  );
}

export function ClassCountPanel({ registers }: { registers: TokenHoldersResponse[] }) {
  if (registers.length < 2) return null;
  const maximum = registers.reduce(
    (largest, { issuedSupply }) =>
      issuedSupply !== null && BigInt(issuedSupply) > BigInt(largest) ? issuedSupply : largest,
    '0',
  );
  return (
    <Section title="Shares by class">
      <p className="text-sm text-text-muted">Issued quantities by class. Class rights may differ.</p>
      <ul className="divide-y divide-border-subtle">
        {registers.map(({ token, issuedSupply, initialized }) => (
          <li key={token.uuid} className="space-y-2 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 flex-1 break-words font-medium text-text-primary">{token.name}</span>
              <span className="break-all tabular-nums text-text-primary">
                {initialized && issuedSupply !== null ? `${formatShareCount(issuedSupply)} shares` : 'Not opened'}
              </span>
            </div>
            {initialized && issuedSupply !== null && (
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-tertiary">
                <div
                  className="h-full rounded-full bg-brand-mid"
                  style={{ width: `${countBarWidth(issuedSupply, maximum)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
