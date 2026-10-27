import { Section } from '@components/Ledger';

export function OwnershipRingPlaceholder() {
  return (
    <svg aria-hidden="true" viewBox="0 0 320 320" className="h-full w-full text-border-strong opacity-55">
      <circle cx="160" cy="160" r="114.4" fill="none" stroke="currentColor" strokeWidth="52.8" />
    </svg>
  );
}

export function OwnershipLoading() {
  return (
    <>
      <div aria-hidden="true" className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
        <div className="h-32 sm:h-14" />
      </div>
      <Section title="Ownership overview">
        <p role="status" className="text-sm text-text-muted">
          Loading the register…
        </p>
        <div aria-hidden="true" className="hidden min-w-0 gap-6 md:grid md:grid-cols-2">
          <div className="mx-auto h-80 w-full max-w-sm">
            <OwnershipRingPlaceholder />
          </div>
        </div>
      </Section>
    </>
  );
}
