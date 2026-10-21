import { SelectField } from '@components/SelectField';
import { CompanyPicker } from '@components/CompanyPicker';
import { LinkRow, Row, Rows, Section, LoadError, Loading, Disclosure } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import {
  DESTINATIONS,
  formatDate,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  formatDateTime,
  shortReference,
} from '@ledova/shared';
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
        {preferences.isError ? (
          <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
            Your account could not be loaded.
          </LoadError>
        ) : (
          <p className="text-sm text-text-muted">Your signed-in account must be checked before opening company team.</p>
        )}
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
    revoking,
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
        {!own.isError && (
          <PageAction
            label="Refresh appointments"
            busy={own.isFetching}
            busyLabel="Refreshing…"
            disabled={disabled}
            onClick={() => void own.refetch()}
          />
        )}
        {own.isPending ? (
          <Loading>Loading your appointments…</Loading>
        ) : own.isError ? (
          <LoadError retry={() => own.refetch()} busy={own.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : appointments.length === 0 ? (
          <p className="text-sm text-text-muted">No company appointments yet.</p>
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
        <CompanyPicker
          companies={companies.map(([uuid, name]) => ({ uuid, name }))}
          value={company}
          disabled={disabled || own.isFetching || own.isError}
          onChange={(uuid) => {
            close();
            setCompany(uuid);
            setSourceId('');
          }}
        />
        {company && (
          <>
            <SelectField
              label="Delegating appointment"
              options={[
                { value: '', label: 'Select a current appointment' },
                ...sources.map((item) => ({
                  value: item.uuid,
                  label: `${scopeLabels(item.delegatableCapabilities)} · appointed ${formatDate(item.createdAt)}`,
                  reference: shortReference(item.uuid),
                })),
              ]}
              value={sourceId}
              disabled={disabled || own.isFetching}
              onChange={setSourceId}
            />
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
                {!team.isError && (
                  <PageAction
                    label="Refresh company team"
                    busy={team.isFetching}
                    busyLabel="Refreshing…"
                    disabled={disabled}
                    onClick={() => void team.refetch()}
                  />
                )}
                {team.isPending ? (
                  <Loading>Loading company team…</Loading>
                ) : team.isError ? (
                  <LoadError retry={() => team.refetch()} busy={team.isFetching}>
                    Company team could not be loaded.
                  </LoadError>
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
        {!invitations.isError && (
          <PageAction
            label="Refresh invitations"
            busy={invitations.isFetching}
            busyLabel="Refreshing…"
            disabled={disabled}
            onClick={() => void invitations.refetch()}
          />
        )}
        {invitations.isPending ? (
          <Loading>Loading your invitations…</Loading>
        ) : invitations.isError ? (
          <LoadError retry={() => invitations.refetch()} busy={invitations.isFetching}>
            Your invitations could not be loaded.
          </LoadError>
        ) : (invitations.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No invitations yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(invitations.data ?? []).map((item) => (
              <li key={item.uuid} className="py-3">
                <Rows>
                  <Row label="Company (provided by the company)">{item.companyName}</Row>
                  <Row label="Personal actions">{scopeLabels(item.capabilities)}</Row>
                  <Row label="May delegate">{scopeLabels(item.delegatableCapabilities)}</Row>
                  <Row label="Acceptance deadline">{formatDateTime(item.acceptanceDeadline)}</Row>
                  <Row label="Accepted">{formatDateTime(item.acceptedAt, 'Not yet accepted')}</Row>
                  <Row label="Appointment expiry">{formatDateTime(item.appointmentExpiresAt, 'No expiry')}</Row>
                </Rows>
                <Disclosure summary="Invitation record">
                  <div className="text-sm">
                    <p className="pt-2">Invitation reference {shortReference(item.uuid)}</p>
                  </div>
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Company eligibility">
        <LinkRow to={DESTINATIONS.companyEligibility.path} label={DESTINATIONS.companyEligibility.title} />
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
        destructive
        busy={revoking}
        busyLabel="Revoking…"
        confirmDisabled={!confirmation || disabled || !canRevoke(confirmation.appointment)}
        onConfirm={() => {
          if (
            !confirmation ||
            ticket.current !== confirmation.ticket ||
            disabled ||
            !canRevoke(confirmation.appointment)
          )
            return;
          void revoke(confirmation.appointment).finally(close);
        }}
      >
        <p className="text-sm text-text-primary">
          Permanently remove appointment {confirmation ? shortReference(confirmation.appointment.uuid) : ''} for{' '}
          {confirmation?.companyName}? This appointment loses its company authority. Its history remains retained.
          {confirmation?.appointment.source !== 'invitation' &&
            ' Another initial self-declaration cannot restore it; revoking an initial or legacy-owner appointment does not reopen admission.'}
        </p>
      </Modal>
    </Page>
  );
}
