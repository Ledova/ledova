import { Section } from '@components/Ledger';
import { OwnershipRingPlaceholder } from './OwnershipRingPlaceholder';

export function OwnershipLoading() {
  return (
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
  );
}
