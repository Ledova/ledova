import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyTeam,
  getCompanyTeamInvitations,
  getOwnCompanyAppointments,
  formatDateTime,
  readEveryPage,
  revokeCompanyAppointment,
  useSubmissionOwner,
  type CompanyTeamAppointment,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch, getSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';
import { registerAppointmentsKey } from '../company-register/useCompanyRegister';
import { AcceptInvitation } from './AcceptInvitation';
import { AppointmentRecord, scopeLabels } from './AppointmentRecord';
import { InvitationForm } from './InvitationForm';
import { EligibilityLinks } from '../eligibility-records/EligibilityLinks';

function CompanyTeam({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const [epoch] = useState(getSessionEpoch);
  const [company, setCompany] = useState<string>();
  const [sourceId, setSourceId] = useState<string>();
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const guard = useCallback(() => {
    assertSessionEpoch(epoch);
    if (!live.current || currentOwner() !== owner) throw new Error('Your account changed. Reopen Company team.');
  }, [currentOwner, owner, epoch]);
  const scope = ['company-team', owner.userUuid, owner.ownerAccountUuid, epoch];
  const appointmentsKey = [...scope, 'appointments'];
  const invitationsKey = [...scope, 'invitations'];
  const teamKey = [...scope, 'team', company];
  const appointments = useQuery({
    queryKey: appointmentsKey,
    retry: false,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        guard();
        const response = await getOwnCompanyAppointments(apiClient, page, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: guard,
          signal,
        });
        guard();
        return response;
      }),
  });
  const invitations = useQuery({
    queryKey: invitationsKey,
    retry: false,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        guard();
        const response = await getCompanyTeamInvitations(apiClient, page, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: guard,
          signal,
        });
        guard();
        return response;
      }),
  });
  const own = appointments.isSuccess ? appointments.data : [];
  const companies = own.filter((record, index) => own.findIndex((item) => item.company === record.company) === index);
  const current = own.filter(
    (record) => record.company === company && record.isEffective && record.status === 'active',
  );
  const source = current.find((record) => record.uuid === sourceId);
  const administers = current.some((record) => record.capabilities.includes('admin'));
  const companyName = companies.find((record) => record.company === company)?.companyName;
  const team = useQuery({
    queryKey: teamKey,
    enabled: !!company && administers && !appointments.isFetching,
    retry: false,
    queryFn: async ({ signal }) => {
      guard();
      const response = await getCompanyTeam(apiClient, company!, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
        signal,
      });
      guard();
      if (response.data.some((record) => record.company !== company))
        throw new Error('The team response did not match the selected company.');
      return response.data;
    },
  });
  const refreshing = appointments.isFetching || invitations.isFetching || (administers && team.isFetching);
  const refresh = () => {
    void appointments.refetch();
    void invitations.refetch();
    if (administers) void team.refetch();
  };
  const revoke = async (target: OwnCompanyAppointment | CompanyTeamAppointment, ownTarget: boolean) => {
    const queryKey = ownTarget ? appointmentsKey : teamKey;
    const targetGuard = () => {
      guard();
      const state = queryClient.getQueryState<(OwnCompanyAppointment | CompanyTeamAppointment)[]>(queryKey);
      const record = state?.data?.find((record) => record.uuid === target.uuid && record.company === target.company);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle' || !record || record.status === 'revoked')
        throw new Error('Refresh the appointment before confirming revocation.');
      if (!ownTarget) {
        const adminState = queryClient.getQueryState<OwnCompanyAppointment[]>(appointmentsKey);
        if (
          adminState?.status !== 'success' ||
          adminState.fetchStatus !== 'idle' ||
          !adminState.data?.some(
            (record) =>
              record.company === target.company &&
              record.isEffective &&
              record.status === 'active' &&
              record.capabilities.includes('admin'),
          )
        )
          throw new Error('Current company administration is required. Refresh your appointments.');
      }
    };
    targetGuard();
    const response = await revokeCompanyAppointment(apiClient, target.uuid, {
      ledovaSessionEpoch: epoch,
      ledovaSubmissionGuard: targetGuard,
    });
    guard();
    const receipt = response.data;
    if (
      receipt.uuid !== target.uuid ||
      receipt.company !== target.company ||
      receipt.status !== 'revoked' ||
      receipt.isEffective ||
      !receipt.revokedAt
    )
      throw new Error('The revocation could not be confirmed. Refresh or confirm a retry.');
    await queryClient.cancelQueries({ queryKey: scope });
    guard();
    queryClient.setQueryData<OwnCompanyAppointment[]>(appointmentsKey, (previous) =>
      previous?.map((record) => (record.uuid === receipt.uuid ? receipt : record)),
    );
    queryClient.setQueryData<CompanyTeamAppointment[]>(teamKey, (previous) =>
      previous?.map((record) =>
        record.uuid === receipt.uuid
          ? {
              ...record,
              status: receipt.status,
              isEffective: receipt.isEffective,
              revokedAt: receipt.revokedAt,
            }
          : record,
      ),
    );
    void queryClient.invalidateQueries({ queryKey: ['company-authority-requests'] });
    void queryClient.invalidateQueries({ queryKey: registerAppointmentsKey(epoch) });
  };
  return (
    <Page
      testID="company-team-screen"
      title="Company team"
      lede="Manage your own company appointments and invitations. Company information is provided by the company; an appointment does not activate the company or approve a register action."
      actions={
        <>
          <Action label="Refresh" disabled={refreshing} onPress={refresh} />
          <EligibilityLinks company />
        </>
      }
      refreshControl={<RefreshControl refreshing={refreshing && !appointments.isPending} onRefresh={refresh} />}
    >
      <Section title="Accept an invitation">
        <AcceptInvitation
          guard={guard}
          onAccepted={() => {
            void appointments.refetch();
          }}
        />
      </Section>
      <Section title="Your appointments">
        <Text style={styles.muted}>
          Your full appointment history, including initial and invited appointments, expiry and revocation. Revocation
          is permanent; declarations and history remain retained.
        </Text>
        {appointments.isPending ? (
          <Text style={styles.muted}>Loading your appointments…</Text>
        ) : appointments.isError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              Your appointments could not be loaded.
            </Text>
            <Action
              label="Retry appointments"
              disabled={appointments.isFetching}
              onPress={() => void appointments.refetch()}
            />
          </View>
        ) : own.length === 0 ? (
          <Text style={styles.muted}>You have no company appointments. You can accept a company invitation above.</Text>
        ) : (
          <Rows>
            {own.map((record) => (
              <AppointmentRecord
                key={record.uuid}
                appointment={record}
                companyName={record.companyName}
                own
                blocked={appointments.isFetching}
                guard={guard}
                onRevoke={() => revoke(record, true)}
              />
            ))}
          </Rows>
        )}
      </Section>
      <Section title="Company and source appointment">
        <Text style={styles.muted}>
          Select a company from your own appointments. Company administration requires a current personal Manage company
          team permission.
        </Text>
        <View style={styles.choices}>
          {companies.map((record) => (
            <Choice
              key={record.company}
              label={record.companyName}
              accessibilityLabel={`Select company ${record.companyName}`}
              accessibilityRole="radio"
              selected={company === record.company}
              disabled={appointments.isFetching}
              onPress={() => {
                setCompany(record.company);
                setSourceId(undefined);
              }}
            />
          ))}
        </View>
        {company && (
          <View style={styles.choices}>
            {current
              .filter((record) => record.delegatableCapabilities.length > 0)
              .map((record) => (
                <Choice
                  key={record.uuid}
                  label={`${record.source === 'initial' ? 'Initial' : record.source === 'legacy_owner' ? 'Legacy owner' : 'Invited'} appointment ${record.uuid}`}
                  accessibilityLabel={`Select source appointment ${record.uuid}`}
                  accessibilityRole="radio"
                  selected={sourceId === record.uuid}
                  disabled={appointments.isFetching}
                  onPress={() => setSourceId(record.uuid)}
                />
              ))}
          </View>
        )}
        {!company && (
          <Text style={styles.muted}>Choose a company to inspect your current invitation and team access.</Text>
        )}
        {company && !source && (
          <Text style={styles.muted}>
            Select a current appointment with delegation permissions to create an invitation.
          </Text>
        )}
        {source && (
          <InvitationForm
            key={`${source.uuid}/${administers}`}
            source={source}
            canAdmin={administers}
            blocked={appointments.isFetching || appointments.isError}
            guard={guard}
            onIssued={() => {
              void invitations.refetch();
            }}
          />
        )}
      </Section>
      {company && (
        <Section title="Company appointments">
          {!administers || appointments.isFetching ? (
            <Text style={styles.muted}>
              Current personal company administration is required to read or revoke other people&apos;s appointments.
            </Text>
          ) : team.isPending ? (
            <Text style={styles.muted}>Loading the company team…</Text>
          ) : team.isError ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                The company team could not be loaded. Refresh your authority or retry.
              </Text>
              <Action label="Retry company team" disabled={team.isFetching} onPress={() => void team.refetch()} />
            </View>
          ) : (
            <Rows>
              {team.data?.map((record) => (
                <AppointmentRecord
                  key={record.uuid}
                  appointment={record}
                  companyName={companyName!}
                  own={own.some((item) => item.uuid === record.uuid)}
                  blocked={team.isFetching || appointments.isFetching}
                  guard={guard}
                  onRevoke={() => revoke(record, false)}
                />
              ))}
            </Rows>
          )}
        </Section>
      )}
      <Section title="Invitations you issued">
        <Text style={styles.muted}>
          Retained invitation history never includes the one-time code. No email is sent.
        </Text>
        {invitations.isPending ? (
          <Text style={styles.muted}>Loading your invitations…</Text>
        ) : invitations.isError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              Your invitation history could not be loaded.
            </Text>
            <Action
              label="Retry invitations"
              disabled={invitations.isFetching}
              onPress={() => void invitations.refetch()}
            />
          </View>
        ) : invitations.data.length === 0 ? (
          <Text style={styles.muted}>You have not issued an invitation.</Text>
        ) : (
          <Rows>
            {invitations.data.map((invitation) => (
              <View key={invitation.uuid} style={styles.entry}>
                <Text style={styles.heading}>{invitation.companyName}</Text>
                <Text style={styles.muted}>{invitation.acceptedAt ? 'Accepted' : 'Not accepted'}</Text>
                <Rows>
                  <Row label="Invitation" mono>
                    {invitation.uuid}
                  </Row>
                  <Row label="Source appointment" mono>
                    {invitation.inviterAppointment}
                  </Row>
                  <Row label="Permissions to exercise">{scopeLabels(invitation.capabilities) || 'None'}</Row>
                  <Row label="Permissions to delegate">{scopeLabels(invitation.delegatableCapabilities) || 'None'}</Row>
                  <Row label="Accept before">{formatDateTime(invitation.acceptanceDeadline)}</Row>
                  <Row label="Appointment expiry">
                    {invitation.appointmentExpiresAt ? formatDateTime(invitation.appointmentExpiresAt) : 'None'}
                  </Row>
                  <Row label="Issued at">{formatDateTime(invitation.createdAt)}</Row>
                  {invitation.acceptedAt && <Row label="Accepted at">{formatDateTime(invitation.acceptedAt)}</Row>}
                </Rows>
              </View>
            ))}
          </Rows>
        )}
      </Section>
    </Page>
  );
}

export function CompanyTeamScreen() {
  const styles = useCompanyStyles();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  return owner ? (
    <CompanyTeam
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${getSessionEpoch()}`}
      owner={owner}
      currentOwner={boundary.get}
    />
  ) : (
    <Page title="Company team">
      <Text style={styles.muted}>
        Verify your signed-in account before accepting invitations or managing appointments.
      </Text>
    </Page>
  );
}
