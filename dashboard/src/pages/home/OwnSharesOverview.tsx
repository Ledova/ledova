import { useId } from 'react';
import { formatShareCount, hasWholeShares, shareCount, type OwnMemberRecord } from '@ledova/shared';

const SERIES = [
  'var(--color-brand-light)',
  'var(--color-info-light)',
  'var(--color-warning-light)',
  'var(--color-error-light)',
  'color-mix(in srgb, var(--color-info-light) 60%, var(--color-error-light))',
];

export function OwnSharesOverview({ classes }: { classes: OwnMemberRecord['classes'] }) {
  const id = useId();
  if (!hasWholeShares(classes) || new Set(classes.map((item) => item.uuid)).size !== classes.length)
    return (
      <p role="status" className="text-sm text-text-muted">
        Your current share quantities are unavailable.
      </p>
    );
  const holdings = classes.filter((item) => BigInt(item.shares) > 0n);
  const total = holdings.reduce((sum, item) => sum + BigInt(item.shares), 0n);
  const segments = holdings.map((item, index) => {
    const previous = holdings.slice(0, index).reduce((sum, holding) => sum + BigInt(holding.shares), 0n);
    const start = Number((previous * 1000000000n) / total) / 10000000;
    return { ...item, start, end: Number(((previous + BigInt(item.shares)) * 1000000000n) / total) / 10000000 };
  });
  const colors = new Map(holdings.map((item, index) => [item.uuid, SERIES[index % SERIES.length]]));
  return (
    <>
      <dl className="grid grid-cols-2 gap-4 border-b border-border-subtle pb-4 sm:gap-6">
        {[
          ['Your holding', shareCount(String(total), 'issued')],
          ['Classes held', String(holdings.length)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="mt-1 break-words text-2xl font-medium tabular-nums text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      {classes.length === 0 ? (
        <p className="text-sm text-text-muted">No issued shares yet.</p>
      ) : (
        <div className={`grid min-w-0 items-center gap-6 ${total > 0n ? 'sm:grid-cols-[12rem_minmax(0,1fr)]' : ''}`}>
          {total > 0n && (
            <svg
              role="img"
              aria-labelledby={`${id}-title ${id}-description`}
              viewBox="0 0 160 160"
              className="mx-auto h-44 w-44 shrink-0"
            >
              <title id={`${id}-title`}>Your issued shares by class</title>
              <desc id={`${id}-description`}>
                {formatShareCount(String(total))} shares held by you across {holdings.length}{' '}
                {holdings.length === 1 ? 'class' : 'classes'}. This chart shows your shares, not company ownership
                percentages. The table lists each class and your shares.
              </desc>
              {segments.map((item) => (
                <circle
                  key={item.uuid}
                  aria-hidden="true"
                  cx="80"
                  cy="80"
                  r="60"
                  fill="none"
                  stroke={colors.get(item.uuid)}
                  strokeWidth="26"
                  pathLength="100"
                  strokeDasharray={`${item.end - item.start} ${100 - item.end + item.start}`}
                  strokeDashoffset={-item.start}
                  transform="rotate(-90 80 80)"
                />
              ))}
              <text x="80" y="78" textAnchor="middle" className="fill-text-primary text-xl font-medium tabular-nums">
                {holdings.length}
              </text>
              <text x="80" y="97" textAnchor="middle" className="fill-text-muted text-xs">
                {holdings.length === 1 ? 'share class' : 'share classes'}
              </text>
            </svg>
          )}
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Your issued shares by class</caption>
            <thead className="text-text-muted">
              <tr className="border-b border-border-subtle">
                <th scope="col" className="pb-2 text-left font-normal">
                  Share class
                </th>
                <th scope="col" className="w-1/3 pb-2 text-right font-normal">
                  Your shares
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {classes.map((item) => (
                <tr key={item.uuid}>
                  <th scope="row" className="py-3 pr-3 text-left font-medium text-text-primary">
                    <span className="inline-flex items-baseline gap-2 text-left">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0"
                        style={{ backgroundColor: colors.get(item.uuid) ?? 'var(--color-text-muted)' }}
                      />
                      <span className="min-w-0 break-words">
                        {item.name}
                        <span className="ml-2 text-xs font-normal text-text-muted">{item.symbol}</span>
                      </span>
                    </span>
                  </th>
                  <td className="break-all py-3 text-right tabular-nums text-text-primary">
                    {formatShareCount(item.shares)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
