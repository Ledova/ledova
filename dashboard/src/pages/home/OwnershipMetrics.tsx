import { formatShareCount, type CompanyOwnershipSummary } from '@ledova/shared';

export function OwnershipMetrics({ summary, own }: { summary: CompanyOwnershipSummary; own?: string }) {
  const unopened = summary.classes.filter(({ initialized }) => !initialized).length;
  return (
    <section aria-label="Company ownership summary" className="border-b border-border-subtle pb-4">
      <dl className={`grid grid-cols-2 gap-4 sm:gap-6 ${own === undefined ? 'sm:grid-cols-3' : 'md:grid-cols-4'}`}>
        {[
          ...(own === undefined ? [] : [['Your shares', formatShareCount(own)]]),
          ['Issued shares', summary.issuedSupply === null ? 'Not complete' : formatShareCount(summary.issuedSupply)],
          ['Current shareholders', summary.totalHolders === null ? 'Not complete' : String(summary.totalHolders)],
          ['Share classes', String(summary.classes.length)],
        ].map(([label, value], index) => (
          <div key={label} className={`min-w-0 ${index === 0 && own === undefined ? 'col-span-2 sm:col-span-1' : ''}`}>
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
