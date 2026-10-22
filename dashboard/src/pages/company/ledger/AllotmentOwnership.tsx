import {
  allotmentOwnershipImpact,
  REGISTER_ALLOTMENT_COPY as COPY,
  type RegisterAllotmentDecisionPreview,
  shareCount,
  shortReference,
} from '@ledova/shared';
import { Disclosure } from '@components/Ledger';
import { Table } from '@components/List';

export function AllotmentOwnership({ preview }: { preview: RegisterAllotmentDecisionPreview }) {
  const impact = allotmentOwnershipImpact(preview);
  if (!impact)
    return (
      <p role="alert" className="text-sm text-text-muted">
        {COPY.OWNERSHIP_UNAVAILABLE}
      </p>
    );
  const table = (rows: typeof impact.rows, label: string) => (
    <Table
      caption={label}
      columns={[{ label: 'Shareholder' }, { label: 'Before', align: 'right' }, { label: 'After', align: 'right' }]}
    >
      {rows.map((row) => (
        <tr key={row.member}>
          <th scope="row" className="px-4 py-3 text-left font-medium">
            {row.name || 'Name not recorded'}
            {row.recipient && ' · Investor'}
            {impact.rows.some((other) => other.member !== row.member && other.name === row.name) && (
              <span className="block text-xs font-normal text-text-muted">
                Member reference {shortReference(row.member)}
              </span>
            )}
          </th>
          <td className="px-4 py-3 text-right tabular-nums">
            <span className="block whitespace-nowrap">{shareCount(row.beforeShares)}</span>
            <span className="text-text-muted">{row.beforePercentage}</span>
          </td>
          <td className="px-4 py-3 text-right tabular-nums">
            <span className="block whitespace-nowrap">{shareCount(row.afterShares)}</span>
            <span className="text-text-muted">{row.afterPercentage}</span>
          </td>
        </tr>
      ))}
    </Table>
  );
  return (
    <section className="space-y-3" aria-label={COPY.OWNERSHIP_TITLE}>
      {table(impact.rows.length > 5 ? impact.rows.slice(0, 1) : impact.rows, 'Share class ownership forecast')}
      {impact.rows.length > 5 && (
        <Disclosure summary={`Other shareholders (${impact.rows.length - 1})`}>
          {table(impact.rows.slice(1), 'Other shareholder ownership forecast')}
        </Disclosure>
      )}
    </section>
  );
}
