import { DESTINATIONS, REGISTER_COPY, appointmentForRegisterStep, type OrderSubmissionOwner } from '@ledova/shared';
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
    <>
      <Section title="Share classes">
        <p className="text-sm text-text-muted">No share classes yet.</p>
      </Section>
      <div className="flex flex-wrap justify-end gap-2">
        <PageLink primary to={DESTINATIONS.companyRegisterSetup.path} label="Add share class" />
      </div>
    </>
  );
}
