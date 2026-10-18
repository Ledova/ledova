import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import {
  DESTINATIONS,
  REGISTER_IMPORT_COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { ownerGuard } from '@pages/company/shared/ownerGuard';

export function RegisterSetup({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const appointments = useOwnAppointments(owner, guard);
  if (appointments.isError)
    return <Unavailable retry={() => void appointments.refetch()} busy={appointments.isFetching} />;
  if (appointments.isPending || appointments.isFetching) return <Loading />;
  const canPrepare = appointments.data.some(
    (appointment) =>
      !appointment.revokedAt && appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
  return (
    <Section title={canPrepare ? 'Set up your share register' : 'Company setup'}>
      <p className="text-sm text-text-muted">
        {canPrepare
          ? REGISTER_IMPORT_COPY.MIRROR_NOTE
          : 'Complete company setup and establish administrator access before bringing in its share records.'}
      </p>
      <Link
        to={canPrepare ? DESTINATIONS.companyRegisterSetup.path : DESTINATIONS.company.path}
        className="mt-2 inline-flex w-fit rounded-lg bg-brand-mid px-4 py-2 text-sm font-medium text-white hover:bg-brand"
      >
        {canPrepare ? 'Set up your share register' : 'Company settings'}
      </Link>
    </Section>
  );
}
