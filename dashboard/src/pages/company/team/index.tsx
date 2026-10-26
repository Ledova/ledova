import { SelectField } from '@components/SelectField';
import { CompanyPicker } from '@components/CompanyPicker';
import { Row, Rows, Section, LoadError, Loading, Disclosure } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { FormActions, Page, PageAction, PageLink } from '@components/Page';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { useEffect, useRef, useState } from 'react';
import {
  formatDate,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  formatDateTime,
  shortReference,
  DESTINATIONS,
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
      <Page>
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
  const settings = useSettingsNavigation();
  const [task, setTask] = useState<'accept' | 'invite' | null>(null);
  const [returnFocus, setReturnFocus] = useState<'accept' | 'invite' | null>(null);
  const [draftSource, setDraftSource] = useState<OwnCompanyAppointment | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const collection = useRef<HTMLDivElement>(null);
  const acceptOpener = useRef<HTMLButtonElement>(null);
  const inviteOpener = useRef<HTMLButtonElement>(null);
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
  } = useCompanyTeam({ owner, currentOwner, editing: task !== null });
  useEffect(() => {
    if (task) heading.current?.focus();
  }, [task]);
  useEffect(() => {
    if (task || !returnFocus || disabled || own.isFetching) return;
    const opener = returnFocus === 'accept' ? acceptOpener.current : inviteOpener.current;
    const destination = opener && !opener.disabled ? opener : collection.current;
    if (destination) {
      destination.focus();
      setReturnFocus(null);
    }
  }, [task, returnFocus, disabled, own.isFetching]);
  const endTask = () => {
    if (disabled) return;
    setReturnFocus(task);
    setTask(null);
  };
  const invitationSource = source ?? (draftSource?.uuid === sourceId ? draftSource : null);
  const sourceReady = own.isSuccess && !own.isFetching && !!source;
  const accountStatus = own.isError ? (
    <LoadError retry={() => own.refetch()} busy={own.isFetching}>
      Your appointments could not be loaded.
    </LoadError>
  ) : own.isPending || own.isFetching ? (
    <Loading>Loading your appointments…</Loading>
  ) : null;
  return (
    <Page lede="Manage company appointments and invitations.">
      <div ref={collection} tabIndex={-1} hidden={!!task} className="space-y-6 focus:outline-none">
        <Section title="Your appointments">
          {accountStatus}
          {own.isSuccess &&
            !own.isFetching &&
            (appointments.length === 0 ? (
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
            ))}
        </Section>
        <div className="flex flex-wrap justify-end gap-2">
          {settings.hasOwnedCompany && (
            <PageLink to={DESTINATIONS.companyAuthority.path} label="Representative authority" />
          )}
          <PageAction
            ref={acceptOpener}
            label="Accept a company invitation"
            disabled={disabled}
            onClick={() => setTask('accept')}
          />
        </div>
        <Section title="Company team">
          {companies.length === 1 ? (
            <p className="text-sm text-text-muted">{companyName || companies[0][1]}</p>
          ) : (
            <CompanyPicker
              companies={companies.map(([uuid, name]) => ({ uuid, name }))}
              value={company}
              disabled={disabled || own.isFetching || own.isError}
              onChange={(uuid) => {
                close();
                setCompany(uuid);
                setSourceId('');
                setDraftSource(null);
              }}
            />
          )}
          {company &&
            (own.isFetching ? (
              <Loading>Loading company team…</Loading>
            ) : canAdmin ? (
              team.isPending ? (
                <Loading>Loading company team…</Loading>
              ) : team.isError ? (
                <LoadError retry={() => team.refetch()} busy={team.isFetching}>
                  Company team could not be loaded.
                </LoadError>
              ) : (team.data ?? []).length === 0 ? (
                <p className="text-sm text-text-muted">No company team appointments.</p>
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
              )
            ) : (
              <p className="text-sm text-text-muted">
                Current personal Manage company information and team authority is required to read or change other
                appointments.
              </p>
            ))}
        </Section>
        <div className="flex flex-wrap justify-end gap-2">
          <PageAction
            ref={inviteOpener}
            label="Invite a company user"
            primary
            disabled={disabled || own.isFetching || own.isError || !company || sources.length === 0}
            onClick={() => {
              const selected = source ?? (sources.length === 1 ? sources[0] : null);
              setSourceId(selected?.uuid ?? '');
              setDraftSource(selected);
              setTask('invite');
            }}
          />
        </div>
        <Section title="Invitations you issued">
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
                  <Disclosure
                    summary={
                      <span className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{item.companyName}</span>
                          <span className="block truncate text-text-muted">{scopeLabels(item.capabilities)}</span>
                        </span>
                        <span className="text-text-muted">{item.acceptedAt ? 'Accepted' : 'Not accepted'}</span>
                      </span>
                    }
                  >
                    <Rows>
                      <Row label="Company">{item.companyName}</Row>
                      <Row label="Personal actions">{scopeLabels(item.capabilities)}</Row>
                      <Row label="May delegate">{scopeLabels(item.delegatableCapabilities)}</Row>
                      <Row label="Acceptance deadline">{formatDateTime(item.acceptanceDeadline)}</Row>
                      <Row label="Accepted">{formatDateTime(item.acceptedAt, 'Not yet accepted')}</Row>
                      <Row label="Appointment expiry">{formatDateTime(item.appointmentExpiresAt, 'No expiry')}</Row>
                    </Rows>
                    <Disclosure summary="Invitation record">
                      <Rows>
                        <Row label="Invitation">{shortReference(item.uuid)}</Row>
                      </Rows>
                    </Disclosure>
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <div hidden={!task} className="space-y-5">
        <h2 ref={heading} tabIndex={-1} className="font-display text-xl text-text-primary focus:outline-none">
          {task === 'accept' ? 'Accept a company invitation' : 'Invite a company user'}
        </h2>
        {accountStatus}
        <div hidden={task !== 'accept'}>
          <Section title="Authorisation">
            <AcceptInvitationForm
              disabled={disabled || task !== 'accept'}
              guard={guard}
              onBusy={setFormBusy}
              onCancel={endTask}
              onRecorded={() => {
                void own.refetch();
                void invitations.refetch();
              }}
            />
          </Section>
        </div>
        <div hidden={task !== 'invite'}>
          <Section title={companyName || 'Company invitation'}>
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
              onChange={(uuid) => {
                setSourceId(uuid);
                setDraftSource(sources.find((item) => item.uuid === uuid) ?? null);
              }}
            />
            {sources.length === 0 && (
              <p className="text-sm text-text-muted">No current appointment can delegate actions for this company.</p>
            )}
            {invitationSource ? (
              <div hidden={!sourceReady}>
                <TeamInvitationForm
                  key={invitationSource.uuid}
                  source={invitationSource}
                  available={invitationSource.delegatableCapabilities.filter((value) => value !== 'admin' || canAdmin)}
                  disabled={disabled || !sourceReady || task !== 'invite'}
                  guard={issueGuard}
                  onBusy={setFormBusy}
                  onCancel={endTask}
                  onRecorded={() => void invitations.refetch()}
                />
              </div>
            ) : null}
            {!sourceReady && (
              <FormActions>
                <PageAction label="Cancel" disabled={disabled} onClick={endTask} />
              </FormActions>
            )}
          </Section>
        </div>
      </div>
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
          Permanently remove{' '}
          {confirmation && 'name' in confirmation.appointment
            ? `${confirmation.appointment.name || confirmation.appointment.email}'s appointment`
            : 'your appointment'}{' '}
          for {confirmation?.companyName}? This appointment loses its company authority. Its history remains retained.
          {confirmation?.appointment.source !== 'invitation' &&
            ' Another initial self-declaration cannot restore it; revoking an initial or legacy-owner appointment does not reopen admission.'}
        </p>
      </Modal>
    </Page>
  );
}
