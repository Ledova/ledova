import { SelectField } from '@components/SelectField';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { Section, LoadError, Loading, Failure } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { FormActions, Page, PageAction, PageLink } from '@components/Page';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useEffect, useRef, useState } from 'react';
import {
  formatDate,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  formatDateTime,
  DESTINATIONS,
} from '@ledova/shared';
import { delegationLabel, scopeLabels, invitationOpen } from '@pages/company/shared/appointments';
import { AcceptInvitationForm } from './AcceptInvitationForm';
import { AppointmentRecord } from './AppointmentRecord';
import { TeamInvitationForm } from './TeamInvitationForm';
import { useCompanyTeam } from './useCompanyTeam';
import { AccountCheck } from '@components/AccountCheck';

export default function CompanyTeamPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (!owner || preferences.isError)
    return (
      <Page>
        <AccountCheck />
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
  const context = useCompanyContext();
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
    sourceId,
    setSourceId,
    setFormBusy,
    error,
    confirmation,
    ticket,
    own,
    invitations,
    appointments,
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
  const [started, setStarted] = useState(false);
  if (!started && own.isSuccess && !own.isFetching && !settings.isLoading) {
    setStarted(true);
    if (appointments.length === 0 && !settings.hasOwnedCompany) setTask('accept');
  }
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
    setStarted(true);
    setReturnFocus(task);
    setTask(null);
  };
  const invitationSource = source ?? (draftSource?.uuid === sourceId ? draftSource : null);
  const sourceReady = own.isSuccess && !own.isFetching && !!source;
  const taskHeading = (name: 'accept' | 'invite', title: string) => (
    <h2
      ref={task === name ? heading : undefined}
      tabIndex={-1}
      className="break-words font-display text-xl tracking-[-0.01em] text-text-primary focus:outline-none"
    >
      {title}
    </h2>
  );
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
            <PageLink
              to={context?.companyPath(DESTINATIONS.companyAuthority.path) ?? DESTINATIONS.companyAuthority.path}
              label="Representative authority"
            />
          )}
          <PageAction
            ref={acceptOpener}
            label="Accept a company invitation"
            disabled={disabled}
            onClick={() => {
              setStarted(true);
              setTask('accept');
            }}
          />
        </div>
        <Section title="Team">
          {!companyName && !own.isPending && !own.isFetching && !own.isError && <CompanyContextNotice />}
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
                <li
                  key={item.uuid}
                  className="grid min-w-0 gap-x-4 gap-y-2 py-4 text-sm md:grid-cols-[minmax(0,1fr)_14rem] xl:grid-cols-[minmax(0,1fr)_14rem_12rem]"
                >
                  <div className="min-w-0 space-y-1 break-words">
                    <p className="font-medium text-text-primary">{item.companyName}</p>
                    <p className="text-text-muted">{scopeLabels(item.capabilities)}</p>
                    {item.delegatableCapabilities.length > 0 && (
                      <p className="text-text-muted">
                        {delegationLabel(item.capabilities, item.delegatableCapabilities)}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 space-y-1 break-words text-text-muted">
                    <p>
                      {item.acceptedAt ? (
                        <>
                          Accepted <span className="whitespace-nowrap">{formatDateTime(item.acceptedAt)}</span>
                        </>
                      ) : (
                        'Not accepted'
                      )}
                    </p>
                    {!item.acceptedAt && (
                      <p>
                        {invitationOpen(item) ? 'Accept before' : 'Deadline passed'}{' '}
                        <span className="whitespace-nowrap">{formatDateTime(item.acceptanceDeadline)}</span>
                      </p>
                    )}
                    <p>
                      {item.appointmentExpiresAt ? (
                        <>
                          Appointment expires{' '}
                          <span className="whitespace-nowrap">{formatDateTime(item.appointmentExpiresAt)}</span>
                        </>
                      ) : (
                        'No appointment expiry'
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <div hidden={!task} className="space-y-5">
        {accountStatus}
        <div hidden={task !== 'accept'}>
          <Section title="Accept a company invitation" header={taskHeading('accept', 'Accept a company invitation')}>
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
          <Section title="Invite a company user" header={taskHeading('invite', 'Invite a company user')}>
            <SelectField
              label="Delegating appointment"
              options={[
                { value: '', label: 'Select a current appointment' },
                ...sources.map((item) => ({
                  value: item.uuid,
                  label: `Appointed ${formatDate(item.createdAt)} · ${scopeLabels(item.delegatableCapabilities)}`,
                  reference: formatDateTime(item.createdAt),
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
      <Failure>{error}</Failure>
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
