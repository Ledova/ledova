import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, RefreshControl, Text, View, type ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  appointmentDates,
  appointmentStatus,
  formatDate,
  formatDateTime,
  issuedInvitationDates,
  scopeFacts,
  scopeLabels,
  useCompanyTeam,
  useSubmissionOwner,
  useUserPreferences,
  type CompanyTeamAppointment,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Action, Actions, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { Page } from '../../components/Page';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRole } from '../../hooks/useRole';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AcceptInvitationForm, TeamInvitationForm } from './TeamForms';

const LEDE = 'Manage company appointments and invitations.';

function useTeamStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    return {
      stack: { gap: theme.spacing.md },
      hidden: { display: 'none' as const },
      row: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
      line: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.md },
      fill: { flex: 1, minWidth: 0 },
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
      status: {
        ...text,
        flexShrink: 0,
        maxWidth: '45%' as const,
        textAlign: 'right' as const,
        color: theme.colors.text.muted,
      },
      small: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
      footer: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        alignItems: 'center' as const,
        columnGap: theme.spacing.md,
      },
      end: { marginLeft: 'auto' as const },
      toggle: {
        paddingVertical: 6,
        fontFamily: theme.fontFamily.medium,
        fontSize: 14,
        color: theme.colors.brand.light,
      },
    };
  });
}

export function TeamScreen() {
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
    />
  );
}

function OwnTeam({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useTeamStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const { directory, companies, company: selected } = useMemberRecordsState();
  const { isCompany } = useRole();
  const scroll = useRef<ScrollView>(null);
  const [task, setTask] = useState<'accept' | 'invite' | null>(null);
  const [draftSource, setDraftSource] = useState<OwnCompanyAppointment | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
  } = useCompanyTeam({
    owner,
    currentOwner,
    editing: task !== null,
    company: selected?.uuid ?? '',
    companyName: selected?.name,
    session: orderSubmissionSession,
  });
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
        <Section title="Your appointments">
          {accountStatus}
          {own.isSuccess &&
            !own.isFetching &&
            (appointments.length === 0 ? (
              <Text style={styles.muted}>No company appointments yet.</Text>
            ) : (
              <Rows>
                {appointments.map((item) => (
                  <AppointmentRecord
                    key={item.uuid}
                    appointment={item}
                    companyName={item.companyName}
                    disabled={disabled}
                    onRevoke={() => confirm(item, item.companyName)}
                  />
                ))}
              </Rows>
            ))}
        </Section>
        <Actions>
          {isCompany && companies.some((row) => row.isOwner) && (
            <Action label="Representative authority" onPress={() => navigation.navigate('Authority')} />
          )}
          <Action
            label="Accept a company invitation"
            disabled={disabled}
            onPress={() => {
              setStarted(true);
              setTask('accept');
            }}
          />
        </Actions>
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
        {accountStatus}
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
      <CustomModal
        visible={!!confirmation}
        title="Revoke appointment permanently?"
        busy={revoking}
        onClose={close}
        actions={
          <Action
            label={revoking ? 'Revoking…' : 'Permanently revoke appointment'}
            primary
            disabled={!confirmation || disabled || !canRevoke(confirmation.appointment)}
            onPress={() => {
              if (
                !confirmation ||
                ticket.current !== confirmation.ticket ||
                disabled ||
                !canRevoke(confirmation.appointment)
              )
                return;
              void revoke(confirmation.appointment).finally(close);
            }}
          />
        }
      >
        {confirmation && (
          <Text style={styles.text}>
            Permanently remove{' '}
            {'name' in confirmation.appointment
              ? `${confirmation.appointment.name || confirmation.appointment.email}'s appointment`
              : 'your appointment'}{' '}
            for {confirmation.companyName}? This appointment loses its company authority. Its history remains retained.
            {confirmation.appointment.source !== 'invitation' &&
              ' Another initial self-declaration cannot restore it; revoking an initial or legacy-owner appointment does not reopen admission.'}
          </Text>
        )}
      </CustomModal>
    </Page>
  );
}

function AppointmentRecord({
  appointment,
  companyName,
  disabled,
  onRevoke,
  teamRecord = false,
}: {
  appointment: OwnCompanyAppointment | CompanyTeamAppointment;
  companyName: string;
  disabled: boolean;
  onRevoke: () => void;
  teamRecord?: boolean;
}) {
  const look = useTeamStyles();
  const [declarationShown, setDeclarationShown] = useState(false);
  const person = teamRecord && 'email' in appointment ? appointment : null;
  const title = person ? person.name || person.email : companyName;
  const declaration =
    !teamRecord && appointment.source !== 'legacy_owner' && 'declarationText' in appointment
      ? appointment.declarationText
      : '';
  const scope = scopeLabels(appointment.capabilities);
  const revocable = appointment.status !== 'revoked';
  return (
    <View style={look.row}>
      <View style={look.line}>
        <Text style={[look.title, look.fill]}>{title}</Text>
        <Text style={look.status}>{appointmentStatus(appointment)}</Text>
      </View>
      <Text style={look.small}>
        {[person?.name && person.email, scopeFacts(appointment.capabilities, appointment.delegatableCapabilities)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={look.small}>{appointmentDates(appointment)}</Text>
      {(!!declaration || revocable) && (
        <View style={look.footer}>
          {!!declaration && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${declarationShown ? 'Hide' : 'Show'} the declaration for ${title}`}
              accessibilityState={{ expanded: declarationShown }}
              onPress={() => setDeclarationShown((shown) => !shown)}
              style={{ alignSelf: 'flex-start' }}
            >
              <Text style={look.toggle}>{declarationShown ? 'Hide the declaration' : 'Show the declaration'}</Text>
            </Pressable>
          )}
          {revocable && (
            <View style={look.end}>
              <Action
                compact
                label="Revoke appointment"
                accessibilityLabel={`Revoke appointment (${title} · ${scope} · appointed ${formatDate(appointment.createdAt)})`}
                disabled={disabled}
                onPress={onRevoke}
              />
            </View>
          )}
        </View>
      )}
      {!!declaration && declarationShown && <Text style={look.muted}>{declaration}</Text>}
    </View>
  );
}
