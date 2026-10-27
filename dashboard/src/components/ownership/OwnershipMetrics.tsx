import { formatShareCount, type CompanyOwnershipSummary } from '@ledova/shared';

export function OwnershipMetrics({
  summary,
  embedded = false,
}: {
  summary: CompanyOwnershipSummary;
  embedded?: boolean;
}) {
  const unopened = summary.classes.filter(({ initialized }) => !initialized).length;
  return (
    <section
      aria-label="Company ownership summary"
      className={
        embedded ? 'border-b border-border-subtle pb-4' : 'rounded-xl border border-border bg-surface-raised p-4 sm:p-5'
      }
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
        {[
          ['Issued shares', summary.issuedSupply === null ? 'Not complete' : formatShareCount(summary.issuedSupply)],
          ['Current shareholders', summary.totalHolders === null ? 'Not complete' : String(summary.totalHolders)],
          ['Share classes', String(summary.classes.length)],
        ].map(([label, value], index) => (
          <div key={label} className={`min-w-0 ${index === 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="mt-1 break-words text-2xl font-medium tabular-nums text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      {unopened > 0 && (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {unopened} {unopened === 1 ? 'class has' : 'classes have'} no opened register. Company totals are not
          complete.
        </p>
      )}
    </section>
  );
}
