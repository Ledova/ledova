import { Link } from 'react-router-dom';
import { DESTINATIONS, REGISTER_IMPORT_COPY } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { useCompany } from '@pages/company/shared/useCompany';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';

export function RegisterSetup() {
  const read = useCompany({ personalOnly: true });
  if (read.error) return <Unavailable retry={() => void read.refetch()} busy={read.isRefreshing} />;
  if (read.isLoading || read.isRefreshing) return <Loading />;
  return (
    <Section title={read.companies.length ? 'Set up your share register' : 'Company setup'}>
      <p className="text-sm text-text-muted">
        {read.companies.length
          ? REGISTER_IMPORT_COPY.MIRROR_NOTE
          : 'Complete company setup and establish administrator access before bringing in its share records.'}
      </p>
      <Link
        to={read.companies.length ? DESTINATIONS.companyRegisterSetup.path : DESTINATIONS.company.path}
        className="mt-2 inline-flex w-fit rounded-lg bg-brand-mid px-4 py-2 text-sm font-medium text-white hover:bg-brand"
      >
        {read.companies.length ? 'Set up your share register' : 'Company settings'}
      </Link>
    </Section>
  );
}
