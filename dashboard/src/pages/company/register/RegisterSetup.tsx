import {
  DESTINATIONS,
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';
import { PageLink } from '@components/Page';
import { useOwnAppointments } from '@hooks/useOwnAppointments';

export function RegisterSetup({ owner, guard }: { owner: OrderSubmissionOwner; guard: () => void }) {
  const appointments = useOwnAppointments(owner, guard);
  if (appointments.isError)
    return (
      <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
        Your appointments could not be loaded.
      </LoadError>
    );
  if (appointments.isPending || appointments.isFetching) return <Loading>Loading your appointments…</Loading>;
  const canPrepare = appointments.data.some(
    (appointment) =>
      !appointment.revokedAt && appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
  if (!canPrepare) return <p className="py-3 text-sm text-text-muted">{REGISTER_COPY.NO_REGISTER}</p>;
  return (
    <Section title={REGISTER_IMPORT_COPY.SETUP}>
      <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.MIRROR_NOTE}</p>
      <PageLink primary to={DESTINATIONS.companyRegisterSetup.path} label={REGISTER_IMPORT_COPY.SETUP} />
    </Section>
  );
}
