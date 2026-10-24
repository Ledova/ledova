import { useId } from 'react';
import {
  REGISTER_COPY,
  formatShareCount,
  ownershipSummary,
  type TokenHoldersResponse,
  shareCount,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { ownershipSegments } from '@pages/company/shared/summary';

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

const SERIES = [
  'var(--color-brand-light)',
  'var(--color-info-light)',
  'var(--color-warning-light)',
  'var(--color-error-light)',
  'color-mix(in srgb, var(--color-info-light) 60%, var(--color-error-light))',
];

function OwnershipDonut({
  register,
  segments,
  colors,
}: {
  register: TokenHoldersResponse;
  segments: ReturnType<typeof ownershipSegments>;
  colors: Map<string, string>;
}) {
  const id = useId();
  const total = BigInt(register.issuedSupply!);
  const slices = segments.map((segment, index) => {
    const previous = segments.slice(0, index).reduce((sum, row) => sum + BigInt(row.shares), 0n);
    return {
      segment,
      start: Number((previous * 1000000000n) / total) / 10000000,
      end: Number(((previous + BigInt(segment.shares)) * 1000000000n) / total) / 10000000,
    };
  });
  return (
    <svg
      role="img"
      aria-labelledby={`${id}-title ${id}-description`}
      viewBox="0 0 160 160"
      className="mx-auto h-40 w-40 shrink-0"
    >
      <title id={`${id}-title`}>{register.token.name} share ownership</title>
      <desc id={`${id}-description`}>
        {shareCount(register.issuedSupply!, 'issued')} held by {register.totalHolders}{' '}
        {register.totalHolders === 1 ? 'shareholder' : 'shareholders'}. Percentages are of this class&apos;s issued
        shares. The legend lists the five largest shareholders and any others.
      </desc>
      {slices.map(({ segment, start, end }) => (
        <circle
          key={segment.member ?? 'others'}
          aria-hidden="true"
          cx="80"
          cy="80"
          r="60"
          fill="none"
          stroke={segment.member ? colors.get(segment.member) : 'var(--color-text-muted)'}
          strokeWidth="26"
          pathLength="100"
          strokeDasharray={`${end - start} ${100 - end + start}`}
          strokeDashoffset={-start}
          transform="rotate(-90 80 80)"
        />
      ))}
      <text x="80" y="78" textAnchor="middle" className="fill-text-primary text-xl font-medium tabular-nums">
        {register.totalHolders}
      </text>
      <text x="80" y="97" textAnchor="middle" className="fill-text-muted text-xs">
        {register.totalHolders === 1 ? 'shareholder' : 'shareholders'}
      </text>
    </svg>
  );
}

export function ShareholderPanels({ registers }: { registers: TokenHoldersResponse[] }) {
  const distributions = registers.map((register) => {
    const segments = ownershipSegments(register);
    return {
      register,
      segments,
      colors: new Map(segments.map((segment, index) => [segment.member ?? 'others', SERIES[index]])),
    };
  });
  return (
    <section aria-label="Share ownership" className="space-y-4">
      <h2 className="font-display text-xl tracking-[-0.01em] text-text-primary">Share ownership</h2>
      <div className="grid items-start gap-5 md:grid-cols-2">
        {distributions.map(({ register, segments, colors }) => (
          <Section key={register.token.uuid} title={`${register.token.name} · ${register.token.symbol}`}>
            {!register.initialized ? (
              <p className="text-sm text-text-muted">
                This share class has no opened register. Issued shares are not recorded.
              </p>
            ) : segments.length === 0 ? (
              <p className="text-sm text-text-muted">No issued shares or current shareholders yet.</p>
            ) : (
              <>
                <p className="break-words text-sm tabular-nums text-text-muted">
                  {shareCount(register.issuedSupply!, 'issued')}
                </p>
                <div className="grid min-w-0 items-center gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] md:grid-cols-1 xl:grid-cols-[10rem_minmax(0,1fr)]">
                  <OwnershipDonut register={register} segments={segments} colors={colors} />
                  <table className="w-full table-fixed text-sm">
                    <caption className="sr-only">Largest shareholders in {register.token.name}</caption>
                    <thead className="text-text-muted">
                      <tr className="border-b border-border-subtle">
                        <th scope="col" className="w-1/2 pb-2 text-left font-normal">
                          Shareholder
                        </th>
                        <th scope="col" className="w-[30%] px-2 pb-2 text-right font-normal">
                          Shares
                        </th>
                        <th scope="col" className="w-[20%] pb-2 text-right font-normal">
                          % of class
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {segments.map((segment) => (
                        <tr key={segment.member ?? 'others'}>
                          <th scope="row" className="py-2 pr-2 text-left font-medium text-text-primary">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span
                                aria-hidden="true"
                                className="h-2 w-2 shrink-0"
                                style={{
                                  backgroundColor: segment.member
                                    ? colors.get(segment.member)
                                    : 'var(--color-text-muted)',
                                }}
                              />
                              <span className="min-w-0 break-words">
                                {segment.name}
                                {segment.member === null && (
                                  <span className="block text-xs font-normal text-text-muted">
                                    {segment.holders} shareholders
                                  </span>
                                )}
                              </span>
                            </span>
                          </th>
                          <td className="break-all px-2 py-2 text-right tabular-nums text-text-primary">
                            {formatShareCount(segment.shares)}
                          </td>
                          <td className="break-words py-2 text-right tabular-nums text-text-primary">
                            {segment.percentage}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {register.initialized && register.waitingEffects === null && (
              <p role="status" className="text-sm text-text-muted">
                {REGISTER_COPY.WAITING_UNKNOWN_NOTE}
              </p>
            )}
            {register.waitingEffects !== null && register.waitingEffects > 0 && (
              <p role="status" className="text-sm text-text-muted">
                {REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}
              </p>
            )}
          </Section>
        ))}
      </div>
    </section>
  );
}
