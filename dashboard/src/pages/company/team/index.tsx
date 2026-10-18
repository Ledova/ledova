import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { LinkRow, Row, Rows, Section } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import { DESTINATIONS, useSubmissionOwner, useUserPreferences, type OrderSubmissionOwner } from '@ledova/shared';
import { scopeLabels } from '@pages/company/shared/appointments';
import { AcceptInvitationForm } from './AcceptInvitationForm';
import { AppointmentRecord } from './AppointmentRecord';
import { TeamInvitationForm } from './TeamInvitationForm';
import { useCompanyTeam } from './useCompanyTeam';

export default function CompanyTeamPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (!owner || preferences.isError)
    return (
      <Page narrow>
        <p className="text-sm text-text-muted">Your signed-in account must be checked before opening company team.</p>
        <PageAction label="Retry your account" onClick={() => void preferences.refetch()} />
      </Page>
    );
  return <OwnTeam key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />;
}

function OwnTeam({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const {
    guard,
    company,
    setCompany,
    sourceId,
    setSourceId,
    setFormBusy,
    error,
    confirmation,
    ticket,
    own,
    invitations,
    appointments,
    companies,
    sources,
    source,
    canAdmin,
    team,
    disabled,
    close,
    canRevoke,
    confirm,
    revoke,
    issueGuard,
    companyName,
  } = useCompanyTeam({
    owner,
    currentOwner,
  });
  return (
    <Page narrow>
      <p className="text-sm text-text-muted">
        Appointments allow only their recorded actions. They do not activate a company or approve a register change.
      </p>
      <Section title="Accept a company invitation">
        <AcceptInvitationForm
          disabled={disabled}
          guard={guard}
          onBusy={setFormBusy}
          onRecorded={() => {
            void own.refetch();
            void invitations.refetch();
          }}
        />
      </Section>
      <Section title="Your appointments">
        <PageAction
          label="Refresh appointments"
          disabled={disabled || own.isFetching}
          onClick={() => void own.refetch()}
        />
        {own.isPending ? (
          <p role="status">Loading your appointments…</p>
        ) : own.isError ? (
          <p role="alert" className="text-sm text-error-light">
            Your appointments could not be loaded. Refresh before using company authority.
          </p>
        ) : appointments.length === 0 ? (
          <p>No company appointments recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {appointments.map((item) => (
              <AppointmentRecord
                key={item.uuid}
                appointment={item}
                companyName={item.companyName}
                disabled={disabled || own.isFetching}
                onRevoke={() => confirm(item, item.companyName)}
              />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Invite and manage a company team">
        <label className={LABEL}>
          Company
          <select
            className={FIELD_CLASS}
            value={company}
            disabled={disabled || own.isFetching || own.isError}
            onChange={(event) => {
              close();
              setCompany(event.target.value);
              setSourceId('');
            }}
          >
            <option value="">Select a company from your appointments</option>
            {companies.map(([uuid, name]) => (
              <option key={uuid} value={uuid}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {company && (
          <>
            <label className={LABEL}>
              Delegating appointment
              <select
                className={FIELD_CLASS}
                value={sourceId}
                disabled={disabled || own.isFetching}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">Select a current appointment</option>
                {sources.map((item) => (
                  <option key={item.uuid} value={item.uuid}>
                    {item.uuid} · {scopeLabels(item.delegatableCapabilities)}
                  </option>
                ))}
              </select>
            </label>
            {sources.length === 0 && <p>No current appointment can delegate actions for this company.</p>}
            {source && (
              <TeamInvitationForm
                key={source.uuid}
                source={source}
                available={source.delegatableCapabilities.filter((value) => value !== 'admin' || canAdmin)}
                disabled={disabled || own.isFetching}
                guard={issueGuard}
                onBusy={setFormBusy}
                onRecorded={() => void invitations.refetch()}
              />
            )}
            {canAdmin ? (
              <>
                <h3 className="text-sm font-medium">Company team</h3>
                <PageAction
                  label="Refresh company team"
                  disabled={disabled || team.isFetching}
                  onClick={() => void team.refetch()}
                />
                {team.isPending ? (
                  <p role="status">Loading company team…</p>
                ) : team.isError ? (
                  <p role="alert" className="text-sm text-error-light">
                    Company team could not be loaded. Refresh before managing it.
                  </p>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {(team.data ?? []).map((item) => (
                      <AppointmentRecord
                        key={item.uuid}
                        appointment={item}
                        companyName={companyName}
                        teamRecord
                        disabled={disabled || team.isFetching}
                        onRevoke={() => confirm(item, companyName)}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p>
                Current personal Manage company information and team authority is required to read or change other
                appointments.
              </p>
            )}
          </>
        )}
      </Section>
      <Section title="Invitations you issued">
        <PageAction
          label="Refresh invitations"
          disabled={disabled || invitations.isFetching}
          onClick={() => void invitations.refetch()}
        />
        {invitations.isPending ? (
          <p role="status">Loading your invitations…</p>
        ) : invitations.isError ? (
          <p role="alert" className="text-sm text-error-light">
            Your invitations could not be loaded.
          </p>
        ) : (invitations.data ?? []).length === 0 ? (
          <p>No invitations recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(invitations.data ?? []).map((item) => (
              <li key={item.uuid} className="py-3">
                <Rows>
                  <Row label="Company (provided by the company)">{item.companyName}</Row>
                  <Row label="Personal actions">{scopeLabels(item.capabilities)}</Row>
                  <Row label="May delegate">{scopeLabels(item.delegatableCapabilities)}</Row>
                  <Row label="Acceptance deadline">{item.acceptanceDeadline}</Row>
                  <Row label="Accepted">{item.acceptedAt || 'Not yet accepted'}</Row>
                  <Row label="Appointment expiry">{item.appointmentExpiresAt || 'No expiry'}</Row>
                </Rows>
                <details className="pt-2 text-sm">
                  <summary className="cursor-pointer text-text-muted">Invitation record</summary>
                  <p className="break-all pt-2">{item.uuid}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Company eligibility">
        <LinkRow to={DESTINATIONS.companyEligibility.path} label="Read your company eligibility queue" />
      </Section>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <Modal
        isOpen={!!confirmation}
        onClose={close}
        title="Revoke appointment permanently?"
        showFooter
        confirmLabel="Permanently revoke appointment"
        confirmDisabled={!confirmation || disabled || !canRevoke(confirmation.appointment)}
        onConfirm={() => {
          if (
            !confirmation ||
            ticket.current !== confirmation.ticket ||
            disabled ||
            !canRevoke(confirmation.appointment)
          )
            return;
          const target = confirmation.appointment;
          close();
          void revoke(target);
        }}
      >
        <p className="text-sm text-text-primary">
          Permanently remove appointment {confirmation?.appointment.uuid} for {confirmation?.companyName}? This
          appointment loses its company authority. Its history remains retained.
          {confirmation?.appointment.source !== 'invitation' &&
            ' Another initial self-declaration cannot restore it; revoking an initial or legacy-owner appointment does not reopen admission.'}
        </p>
      </Modal>
    </Page>
  );
}
