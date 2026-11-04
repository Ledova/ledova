import { DESTINATIONS, useCompanyTeam, useSubmissionOwner, type OrderSubmissionOwner } from '@ledova/shared';
import { Failure, LoadError, Loading, Section } from '@components/Ledger';
import { PageLink } from '@components/Page';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { AppointmentRecord } from '@pages/company/team/AppointmentRecord';
import { RevokeAppointmentDialog } from '@pages/company/team/RevokeAppointmentDialog';

export function YourAppointments() {
  const { owner, boundary } = useSubmissionOwner();
  return owner ? (
    <OwnAppointments key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
  ) : null;
}

function OwnAppointments({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const settings = useSettingsNavigation();
  const context = useCompanyContext();
  const team = useCompanyTeam({
    owner,
    currentOwner,
    company: context?.companyUuid ?? null,
    companyName: context?.company?.name,
    ownOnly: true,
  });
  const { own, appointments, disabled, confirm, error } = team;
  return (
    <>
      <Section title="Your appointments">
        {own.isError ? (
          <LoadError retry={() => own.refetch()} busy={own.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : own.isPending || own.isFetching ? (
          <Loading>Loading your appointments…</Loading>
        ) : appointments.length === 0 ? (
          <p className="text-sm text-text-muted">No company appointments yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {appointments.map((item) => (
              <AppointmentRecord
                key={item.uuid}
                appointment={item}
                companyName={item.companyName}
                disabled={disabled}
                onRevoke={() => confirm(item, item.companyName)}
              />
            ))}
          </ul>
        )}
        {settings.hasOwnedCompany && (
          <div className="flex justify-end">
            <PageLink
              compact
              to={context?.companyPath(DESTINATIONS.companyAuthority.path) ?? DESTINATIONS.companyAuthority.path}
              label="Representative authority"
            />
          </div>
        )}
        <Failure>{error}</Failure>
      </Section>
      <RevokeAppointmentDialog team={team} />
    </>
  );
}
