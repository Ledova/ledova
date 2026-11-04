import { SelectField } from '@components/SelectField';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { Section, LoadError, Loading, Failure } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  formatDate,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  formatDateTime,
  issuedInvitationDates,
  scopeFacts,
  scopeLabels,
  useCompanyTeam,
} from '@ledova/shared';
import { AcceptInvitationForm } from './AcceptInvitationForm';
import { AppointmentRecord } from '@components/AppointmentRecord';
import { RevokeAppointmentDialog } from '@components/RevokeAppointmentDialog';
import { TeamInvitationForm } from './TeamInvitationForm';
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
  const location = useLocation();
  const [task, setTask] = useState<'accept' | 'invite' | null>(null);
  const [returnFocus, setReturnFocus] = useState<'accept' | 'invite' | null>(null);
  const [draftSource, setDraftSource] = useState<OwnCompanyAppointment | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const collection = useRef<HTMLDivElement>(null);
  const inviteOpener = useRef<HTMLButtonElement>(null);
  const teamState = useCompanyTeam({
    owner,
    currentOwner,
    editing: task !== null,
    company: context ? (context.companyUuid ?? '') : new URLSearchParams(location.search).get('company'),
    companyName: context?.company?.name,
  });
  const {
    guard,
    company,
    sourceId,
    setSourceId,
    setFormBusy,
    error,
    own,
    invitations,
    appointments,
    sources,
    source,
    canAdmin,
    team,
    disabled,
    confirm,
    issueGuard,
    companyName,
  } = teamState;
  const [started, setStarted] = useState(false);
  if (!started && own.isSuccess && !own.isFetching && !settings.isLoading) {
    setStarted(true);
    if (location.hash === '#accept' || (appointments.length === 0 && !settings.hasOwnedCompany)) setTask('accept');
  }
  useEffect(() => {
    if (task) heading.current?.focus();
  }, [task]);
  useEffect(() => {
    if (task || !returnFocus || disabled || own.isFetching) return;
    const opener = returnFocus === 'invite' ? inviteOpener.current : null;
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
        {own.isError && (
          <LoadError retry={() => own.refetch()} busy={own.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        )}
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
                <li key={item.uuid} className="flex min-w-0 flex-col gap-1 py-3 text-sm">
                  <p className="break-words font-medium text-text-primary">{item.companyName}</p>
                  <p className="break-words text-xs text-text-muted">
                    {scopeFacts(item.capabilities, item.delegatableCapabilities)}
                  </p>
                  <p className="break-words text-xs text-text-muted">{issuedInvitationDates(item)}</p>
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
      <RevokeAppointmentDialog team={teamState} />
    </Page>
  );
}
