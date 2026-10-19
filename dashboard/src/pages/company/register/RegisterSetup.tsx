import { Link } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { useOwnAppointments } from '@hooks/useOwnAppointments';

export function RegisterSetup({ owner, guard }: { owner: OrderSubmissionOwner; guard: () => void }) {
  const appointments = useOwnAppointments(owner, guard);
  if (appointments.isError)
    return <Unavailable retry={() => void appointments.refetch()} busy={appointments.isFetching} />;
  if (appointments.isPending || appointments.isFetching) return <Loading />;
  const canPrepare = appointments.data.some(
    (appointment) =>
      !appointment.revokedAt && appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
  if (!canPrepare) return <p className="py-3 text-sm text-text-muted">{REGISTER_COPY.NO_REGISTER}</p>;
  return (
    <Section title="Set up your share register">
      <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.MIRROR_NOTE}</p>
      <Link
        to={DESTINATIONS.companyRegisterSetup.path}
        className="mt-2 inline-flex w-fit rounded-lg bg-brand-mid px-4 py-2 text-sm font-medium text-white hover:bg-brand"
      >
        Set up your share register
      </Link>
    </Section>
  );
}
