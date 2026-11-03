import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, RefreshControl, Text, View, type ScrollView } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  INVITATION_FIELDS,
  MEMBER_INVITATION_STATUS_LABELS,
  formatDate,
  formatDateTime,
  useErrorSummary,
  useMemberAccessForm,
  useSubmissionOwner,
  type MemberInvitation,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Action, Actions, FormActions, LoadError, Loading, Outcome, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { PersonSelect } from './PersonSelect';
import { useCompanyRegisters } from './useCompanyRegisters';
import { useShareholderStyles } from './useShareholderStyles';

const TITLE = 'Member access';
const LEDE = 'Invite people to their records and manage their access.';

export function MemberAccessScreen({ route }: { route: RouteProp<SignedInStackParamList, 'MemberAccess'> }) {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing) {
    const inviteMember = route.params?.company === company.uuid ? route.params.inviteMember : undefined;
    return (
      <CompanyMemberAccess
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}/${inviteMember ?? ''}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
        inviteMember={inviteMember}
      />
    );
  }
  return (
    <Page testID="member-access-scroll" title={TITLE} lede={LEDE}>
      {!owner ? (
        <AccountCheck />
      ) : directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your company access could not be confirmed.
        </LoadError>
      ) : choosing ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <CompanyContextNotice />
      )}
    </Page>
  );
}

function CompanyMemberAccess({
  owner,
  currentOwner,
  company,
  inviteMember,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  inviteMember?: string;
}) {
  const theme = useAppTheme();
  const scroll = useRef<ScrollView>(null);
  const source = useCompanyRegisters(owner, currentOwner, company, 'member access');
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const toTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  return (
    <Page
      ref={scroll}
      testID="member-access-scroll"
      title={TITLE}
      lede={LEDE}
      refreshControl={
        <RefreshControl
          testID="member-access-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || open) return;
            setRefreshing(true);
            void source.retry().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {source.accountError ? (
        <LoadError retry={source.retryAccount} busy={source.isRefreshing}>
          Your account could not be loaded.
        </LoadError>
      ) : source.hasError ? (
        <LoadError retry={source.retry} busy={source.isRefreshing}>
          The register could not be loaded.
        </LoadError>
      ) : !source.registers ? (
        <Loading>Loading the register…</Loading>
      ) : null}
      {!!source.registers && (
        <MemberAccess
          owner={owner}
          guard={source.guard}
          company={company}
          registers={source.registers}
          sourceReady={source.sourceReady}
          inviteMember={inviteMember}
          refreshing={refreshing}
          onOpenChange={setOpen}
          onInviting={toTop}
        />
      )}
    </Page>
  );
}

function MemberAccess({
  owner,
  guard,
  company,
  registers,
  sourceReady,
  inviteMember,
  refreshing,
  onOpenChange,
  onInviting,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
  sourceReady: boolean;
  inviteMember?: string;
  refreshing: boolean;
  onOpenChange: (open: boolean) => void;
  onInviting: () => void;
}) {
  const styles = useCompanyStyles();
  const look = useShareholderStyles();
  const {
    access,
    awards,
    candidates,
    recipientsError,
    recipientsReady,
    member,
    email,
    memberName,
    setInvitation,
    reason,
    setReason,
    held,
    problems,
    refresh,
  } = useMemberAccessForm({
    company,
    owner,
    guard,
    registers,
    sourceReady,
    inviteMember,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const checks = useErrorSummary(problems);
  const candidateOf = new Map(candidates.map((candidate) => [candidate.uuid, candidate]));
  const [running, setRunning] = useState(false);
  const [invitationView, setInvitationView] = useState({
    open: false,
    target: '',
    receipt: access.invitationReceipt,
  });
  const inviting = invitationView.open && invitationView.receipt === access.invitationReceipt;
  const setInviting = (next: boolean) =>
    setInvitationView((current) => ({ ...current, open: next, receipt: access.invitationReceipt }));
  const [revokeMember, setRevokeMember] = useState('');
  const [revoking, setRevoking] = useState<{ uuid: string; name: string } | null>(null);
  const shown = !!inviteMember && member?.uuid === inviteMember;
  const target = `${company}:${inviteMember}`;
  if (shown && invitationView.target !== target)
    setInvitationView({ open: true, target, receipt: access.invitationReceipt });
  const busy = held || refreshing;
  useEffect(() => {
    onOpenChange(inviting || !!revokeMember || held);
  }, [onOpenChange, inviting, revokeMember, held]);
  useEffect(() => {
    if (inviting) onInviting();
  }, [inviting, onInviting]);
  const invitations = access.access?.invitations ?? [];
  const associations = access.access?.associations ?? [];
  const deadline = (item: MemberInvitation) =>
    item.status === 'pending'
      ? `Accept before ${formatDateTime(item.acceptanceDeadline)}`
      : item.status === 'expired'
        ? `Deadline ${formatDateTime(item.acceptanceDeadline)}`
        : '';
  const error = access.readFailed ? access.failure : access.error;
  const closeInvitation = () => {
    Keyboard.dismiss();
    checks.reset();
    setInviting(false);
  };
  return (
    <>
      {access.readFailed && (
        <LoadError
          retry={() => {
            setRunning(true);
            void refresh().finally(() => setRunning(false));
          }}
          busy={running || access.busy}
        >
          Member access could not be loaded.
        </LoadError>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!access.notice && <Outcome>{access.notice}</Outcome>}
      {access.retry && (
        <Actions>
          <Action
            label="Retry original company member action"
            disabled={access.busy}
            onPress={() => void access.recover()}
          />
        </Actions>
      )}
      <View style={[look.stack, inviting && look.hidden]}>
        {!access.readFailed && (!access.access || associations.length === 0) && (
          <Section title="People">
            {!access.access ? (
              access.readable && !access.canAdminister ? (
                <Text style={look.muted}>A company administrator manages member access.</Text>
              ) : (
                <Loading>Loading member access…</Loading>
              )
            ) : (
              <Text style={look.muted}>No member access yet.</Text>
            )}
          </Section>
        )}
        {associations.length > 0 && (
          <Section title="People">
            <View accessibilityLabel="Member access records">
              <Rows>
                {associations.map((association) => {
                  const name = memberName(association.member);
                  return (
                    <View key={association.uuid} style={look.row}>
                      <View style={look.line}>
                        <View style={look.lines}>
                          <Text style={look.title}>{name}</Text>
                          <Text style={look.muted}>{association.acceptedEmail}</Text>
                        </View>
                        <Text style={look.status}>{association.current ? 'Current access' : 'Revoked access'}</Text>
                      </View>
                      <Text style={look.muted}>Linked: {formatDate(association.createdAt)}</Text>
                      {association.current && revokeMember !== association.uuid && (
                        <Actions>
                          <Action
                            label="Revoke access"
                            accessibilityLabel={`Revoke access (${name}, ${association.acceptedEmail})`}
                            disabled={busy}
                            onPress={() => {
                              checks.reset();
                              setReason('');
                              setRevokeMember(association.uuid);
                            }}
                          />
                        </Actions>
                      )}
                      {association.current && revokeMember === association.uuid && (
                        <View style={look.group}>
                          <Field
                            label="Company action reason"
                            value={reason}
                            maxLength={FIELD_LIMITS.REASON}
                            multiline
                            editable={!held}
                            error={checks.field('reason').error}
                            onChange={setReason}
                          />
                          <FormActions>
                            <Action
                              label="Cancel"
                              accessibilityLabel={`Cancel (revoke access for ${name})`}
                              disabled={held}
                              onPress={() => {
                                Keyboard.dismiss();
                                checks.reset();
                                setRevokeMember('');
                              }}
                            />
                            <Action
                              label="Revoke access"
                              accessibilityLabel={`Revoke access for ${name}`}
                              disabled={held}
                              onPress={() => {
                                if (held || !checks.check(['reason'])) return;
                                Keyboard.dismiss();
                                setRevoking({ uuid: association.uuid, name });
                              }}
                            />
                          </FormActions>
                        </View>
                      )}
                    </View>
                  );
                })}
              </Rows>
            </View>
          </Section>
        )}
        {!access.readFailed && access.access && invitations.length === 0 && (
          <Section title="Invitations">
            <Text style={look.muted}>No invitations yet.</Text>
          </Section>
        )}
        {invitations.length > 0 && (
          <Section title="Invitations">
            <View accessibilityLabel="Member invitations">
              <Rows>
                {invitations.map((item) => (
                  <View key={item.uuid} style={look.row}>
                    <View style={look.line}>
                      <View style={look.lines}>
                        <Text style={look.title}>{memberName(item.member)}</Text>
                        <Text style={look.muted}>{item.intendedEmail}</Text>
                      </View>
                      <Text style={look.status}>{MEMBER_INVITATION_STATUS_LABELS[item.status]}</Text>
                    </View>
                    <Text style={look.muted}>Invited: {formatDate(item.createdAt)}</Text>
                    {!!deadline(item) && <Text style={look.muted}>{deadline(item)}</Text>}
                  </View>
                ))}
              </Rows>
            </View>
          </Section>
        )}
        {access.admin && (
          <Actions>
            <Action
              label="Invite a member"
              primary
              disabled={busy}
              onPress={() => {
                checks.reset();
                setInviting(true);
              }}
            />
          </Actions>
        )}
      </View>
      {inviting && access.admin && (
        <Section title="Invite a member">
          <PersonSelect
            label="Member or award recipient"
            people={candidates.map((candidate) => ({
              member: candidate.uuid,
              name: candidate.name,
              residentialAddress: '',
              walletless: true,
              particularsRetained: true,
              currentShares: '0',
              lastCeasedOn: null,
              awardOnly: candidate.sources.length === 1 && candidate.sources[0] === 'Award recipient',
            }))}
            value={member?.uuid ?? ''}
            onChange={(value) => setInvitation({ company, member: value, email })}
            disabled={held || !recipientsReady}
            error={checks.field('member').error}
            context={(person) => {
              const candidate = candidateOf.get(person.member);
              return candidate
                ? [candidate.classes.join(', '), ...(person.awardOnly ? [] : [candidate.sources.join(', ')])].join(
                    ' · ',
                  )
                : '';
            }}
          />
          <Field
            label="Intended recipient email"
            value={email}
            maxLength={FIELD_LIMITS.EMAIL}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!held}
            error={checks.field('email').error}
            onChange={(value) => setInvitation({ company, member: member?.uuid ?? '', email: value })}
          />
          {awards.isPending && <Loading>Loading company recipients…</Loading>}
          {awards.isError ? (
            <LoadError retry={() => awards.refetch()} busy={awards.isFetching}>
              The company recipients could not be loaded.
            </LoadError>
          ) : (
            !!recipientsError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {recipientsError}
              </Text>
            )
          )}
          {recipientsReady && candidates.length === 0 && (
            <Text style={look.muted}>Record a member or employee award before inviting its recipient.</Text>
          )}
          <Text style={look.muted}>
            Emails this person a link to accept access to their own shares and employee awards.
          </Text>
          <FormActions>
            <Action label="Cancel" disabled={held} onPress={closeInvitation} />
            <Action
              label={access.busy ? 'Sending invitation…' : 'Send invitation'}
              primary
              disabled={held || !recipientsReady}
              onPress={() => {
                if (held || !recipientsReady || !checks.check(INVITATION_FIELDS) || !member) return;
                Keyboard.dismiss();
                void access.invite(member.uuid, email.trim());
              }}
            />
          </FormActions>
        </Section>
      )}
      <CustomModal
        visible={!!revoking}
        title={revoking ? `Revoke access for ${revoking.name}?` : 'Revoke access'}
        busy={access.busy}
        onClose={() => setRevoking(null)}
        actions={
          <Action
            label={access.busy ? 'Revoking…' : 'Revoke access'}
            primary
            disabled={held || !reason.trim() || !access.admin}
            onPress={() => {
              if (!revoking || held || !reason.trim() || !access.admin) return;
              void Promise.resolve(access.revoke(revoking.uuid, reason.trim())).finally(() => {
                setRevoking(null);
                setRevokeMember('');
              });
            }}
          />
        }
      >
        <Text style={styles.text}>They lose access to their own records. Relinking needs a new invitation.</Text>
      </CustomModal>
    </>
  );
}
