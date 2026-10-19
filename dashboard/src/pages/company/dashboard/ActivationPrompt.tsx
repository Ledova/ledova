import { Link } from 'react-router-dom';
import {
  COMPANY_ACTIVATION_COPY,
  DESTINATIONS,
  companiesAwaitingActivation,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { useOwnAppointments } from '@hooks/useOwnAppointments';

export function ActivationPrompt({ owner, guard }: { owner: OrderSubmissionOwner; guard: () => void }) {
  const appointments = useOwnAppointments(owner, guard);
  const companies = companiesAwaitingActivation(appointments.data ?? []);
  if (companies.length === 0) return null;
  return (
    <Section title={companies.length === 1 ? `Activate ${companies[0]!.name}` : 'Activate your companies'}>
      <p className="text-sm text-text-muted">{COMPANY_ACTIVATION_COPY.PROMPT}</p>
      <Link
        to={DESTINATIONS.companyListing.path}
        className="mt-2 inline-flex w-fit rounded-lg bg-brand-mid px-4 py-2 text-sm font-medium text-white hover:bg-brand"
      >
        {COMPANY_ACTIVATION_COPY.ACTION}
      </Link>
    </Section>
  );
}
