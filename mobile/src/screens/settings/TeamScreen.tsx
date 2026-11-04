import { useEffect, useRef, useState } from 'react';
import { Keyboard, RefreshControl, Text, View, type ScrollView } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import {
  formatDate,
  formatDateTime,
  issuedInvitationDates,
  scopeFacts,
  scopeLabels,
  useCompanyTeam,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Action, Actions, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AppointmentRecord, RevokeAppointmentModal, useTeamStyles } from './Appointments';
import { AcceptInvitationForm, TeamInvitationForm } from './TeamForms';

const LEDE = 'Manage company appointments and invitations.';

export function TeamScreen({ route }: { route?: RouteProp<SignedInStackParamList, 'Team'> }) {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  if (!owner || preferences.isError)
    return (
      <Page testID="team-scroll" title="Team">
        <AccountCheck />
      </Page>
    );
  return (
    <OwnTeam
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      owner={owner}
      currentOwner={boundary.get}
      accept={!!route?.params?.accept}
    />
  );
}

function OwnTeam({
  owner,
  currentOwner,
  accept,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accept: boolean;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useTeamStyles();
  const { directory, companies, company: selected } = useMemberRecordsState();
  const scroll = useRef<ScrollView>(null);
  const [task, setTask] = useState<'accept' | 'invite' | null>(accept ? 'accept' : null);
  const [draftSource, setDraftSource] = useState<OwnCompanyAppointment | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const teamState = useCompanyTeam({
    owner,
    currentOwner,
    editing: task !== null,
    company: selected?.uuid ?? '',
    companyName: selected?.name,
    session: orderSubmissionSession,
  });
  const {
    guard,
    company,
    sourceId,
    setSourceId,
    setFormBusy,
    error,
    confirmation,
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
  if (!started && own.isSuccess && !own.isFetching && !directory.isLoading && !directory.isRefreshing) {
    setStarted(true);
    if (appointments.length === 0 && !companies.some((row) => row.isOwner)) setTask('accept');
  }
  useEffect(() => {
    if (task) scroll.current?.scrollTo({ y: 0, animated: false });
  }, [task]);
  const endTask = () => {
    if (disabled) return;
    Keyboard.dismiss();
    setStarted(true);
    setTask(null);
  };
  const invitationSource = source ?? (draftSource?.uuid === sourceId ? draftSource : null);
  const sourceReady = own.isSuccess && !own.isFetching && !!source;
  const choosing = directory.isLoading || (!selected && companies.length > 0);
  const accountStatus = own.isError ? (
    <LoadError retry={() => own.refetch()} busy={own.isFetching}>
      Your appointments could not be loaded.
    </LoadError>
  ) : own.isPending || own.isFetching ? (
    <Loading>Loading your appointments…</Loading>
  ) : null;
  return (
    <Page
      ref={scroll}
      testID="team-scroll"
      title="Team"
      lede={LEDE}
      refreshControl={
        <RefreshControl
          testID="team-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || task || disabled || confirmation) return;
            setRefreshing(true);
            void Promise.all([own.refetch(), invitations.refetch(), ...(canAdmin ? [team.refetch()] : [])]).finally(
              () => setRefreshing(false),
            );
          }}
        />
      }
    >
      <View style={[look.stack, !!task && look.hidden]}>
        {own.isError && (
          <LoadError retry={() => own.refetch()} busy={own.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        )}
        <Section title="Team">
          {!companyName &&
            !own.isPending &&
            !own.isFetching &&
            !own.isError &&
            (choosing ? <Loading>Loading company team…</Loading> : <CompanyContextNotice />)}
          {!!company &&
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
                <Text style={styles.muted}>No company team appointments.</Text>
              ) : (
                <Rows>
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
                </Rows>
              )
            ) : (
              <Text style={styles.muted}>
                Current personal Manage company information and team authority is required to read or change other
                appointments.
              </Text>
            ))}
        </Section>
        <Actions>
          <Action
            label="Invite a company user"
            primary
            disabled={disabled || own.isFetching || own.isError || !company || sources.length === 0}
            onPress={() => {
              const chosen = source ?? (sources.length === 1 ? sources[0] : null);
              setSourceId(chosen?.uuid ?? '');
              setDraftSource(chosen);
              setTask('invite');
            }}
          />
        </Actions>
        <Section title="Invitations you issued">
          {invitations.isPending ? (
            <Loading>Loading your invitations…</Loading>
          ) : invitations.isError ? (
            <LoadError retry={() => invitations.refetch()} busy={invitations.isFetching}>
              Your invitations could not be loaded.
            </LoadError>
          ) : (invitations.data ?? []).length === 0 ? (
            <Text style={styles.muted}>No invitations yet.</Text>
          ) : (
            <Rows>
              {(invitations.data ?? []).map((item) => (
                <View key={item.uuid} style={look.row}>
                  <Text style={look.title}>{item.companyName}</Text>
                  <Text style={look.small}>{scopeFacts(item.capabilities, item.delegatableCapabilities)}</Text>
                  <Text style={look.small}>{issuedInvitationDates(item)}</Text>
                </View>
              ))}
            </Rows>
          )}
        </Section>
      </View>
      <View style={[look.stack, !task && look.hidden]}>
        {task === 'invite' && accountStatus}
        <View style={task !== 'accept' && look.hidden}>
          <Section title="Accept a company invitation">
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
        </View>
        <View style={task !== 'invite' && look.hidden}>
          <Section title="Invite a company user">
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
              <Text style={styles.muted}>No current appointment can delegate actions for this company.</Text>
            )}
            {invitationSource ? (
              <View style={!sourceReady && look.hidden}>
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
              </View>
            ) : null}
            {!sourceReady && (
              <FormActions>
                <Action label="Cancel" disabled={disabled} onPress={endTask} />
              </FormActions>
            )}
          </Section>
        </View>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <RevokeAppointmentModal team={teamState} />
    </Page>
  );
}
