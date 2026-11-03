import { useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  REGISTER_PARTICULARS_COPY,
  USER_PREFERENCES_QUERY_KEY,
  appointmentForParticularsEdit,
  appointmentForRegisterStep,
  formatDate,
  formatDateTime,
  formatShareCount,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  registerClassesKey,
  registersKey,
  shareCount,
  sharePercentage,
  signedShares,
  useCompanyMemberAccess,
  useOwnAppointments,
  useShareholder,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Fact, LinkRow, LoadError, Loading, Outcome, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useShareholderStyles } from './useShareholderStyles';

const PRIVATE_NOTE =
  'Particulars, history and awards show only to someone with a current company register appointment.';

interface Read {
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  fetchStatus: string;
  refetch: () => unknown;
}

export function ShareholderScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Shareholder'> }) {
  const { company, member, outcome } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  if (owner && !preferences.isError && readable && !directory.hasError && !directory.isLoading)
    return (
      <OwnShareholder
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${member}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company}
        member={member}
        outcome={outcome}
      />
    );
  return (
    <Page testID="shareholder-scroll" title={DESTINATIONS.companyShareholder.title}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnShareholder({
  owner,
  currentOwner,
  company,
  member,
  outcome,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  member: string;
  outcome?: string;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useShareholderStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen the register.');
    },
    [owner, currentOwner],
  );
  const data = useShareholder(owner, guard, company, member, orderSubmissionSession);
  const preferenceRead = useUserPreferences();
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const appointments = useOwnAppointments(owner, guard, { enabled: !!data.company, session: orderSubmissionSession });
  const sourceReady =
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.classes.isSuccess &&
    data.classes.fetchStatus === 'idle' &&
    data.registers.isSuccess &&
    data.registers.fetchStatus === 'idle' &&
    !!data.company;
  const access = useCompanyMemberAccess(company, randomUUID, orderSubmissionSession, sourceReady);
  const prepare =
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  const edit =
    appointments.isSuccess && !appointments.isFetching && !!appointmentForParticularsEdit(appointments.data, company);
  const guardEdit = () => {
    guard();
    for (const key of [
      USER_PREFERENCES_QUERY_KEY,
      registerClassesKey(owner),
      registersKey(owner, data.tokens),
      ownAppointmentsKey(owner),
    ]) {
      const current = client.getQueryState(key);
      if (current?.status !== 'success' || current.fetchStatus !== 'idle')
        throw new Error('Refresh the register and your current appointment.');
    }
    if (
      !appointmentForParticularsEdit(
        client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
        company,
      )
    )
      throw new Error('A current company appointment that can change particulars is required.');
  };
  const authorised =
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const settled = (query: Read) => authorised && query.isSuccess && query.fetchStatus === 'idle';
  const privately = (query: Read, noun: string, render: () => ReactNode) =>
    appointments.isError ? (
      <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
        Your appointments could not be loaded.
      </LoadError>
    ) : !appointments.isSuccess || appointments.fetchStatus !== 'idle' ? (
      <Loading>Loading your appointments…</Loading>
    ) : !authorised ? (
      <Text style={look.muted}>{PRIVATE_NOTE}</Text>
    ) : query.isError ? (
      <LoadError retry={() => query.refetch()} busy={query.isFetching}>
        {`${noun} could not be loaded.`}
      </LoadError>
    ) : !settled(query) ? (
      <Loading>{`Loading ${noun.toLowerCase()}…`}</Loading>
    ) : (
      render()
    );

  let title: string = DESTINATIONS.companyShareholder.title;
  let content: ReactNode;
  if (preferenceRead.isError)
    content = (
      <LoadError retry={() => preferenceRead.refetch()} busy={preferenceRead.isFetching}>
        Your account could not be loaded.
      </LoadError>
    );
  else if (data.classes.isPending) content = <Loading>Loading the register…</Loading>;
  else if (data.classes.isError || data.registers.isError)
    content = (
      <LoadError
        retry={() => {
          void data.classes.refetch();
          void data.registers.refetch();
        }}
        busy={data.classes.isFetching || data.registers.isFetching}
      >
        The register could not be loaded.
      </LoadError>
    );
  else if (!data.company) content = <Text style={look.muted}>This shareholder is not on a register you can read.</Text>;
  else if (!sourceReady) content = <Loading>Loading the register…</Loading>;
  else {
    const registers = data.registers.data ?? [];
    const holdings = registers.flatMap((register) =>
      register.holders.filter((holder) => holder.member === member).map((holder) => ({ register, holder })),
    );
    const former = registers.flatMap((register) =>
      (register.formerMembers ?? []).filter((row) => row.member === member).map((row) => ({ register, row })),
    );
    const recorded = settled(data.particulars)
      ? data.particulars.data?.members.find((row) => row.member === member)
      : undefined;
    const first = holdings[0];
    title = first
      ? first.holder.name || HOLDER_TYPE_LABELS[first.holder.holderType]
      : recorded?.name || former[0]?.row.name || REGISTER_PARTICULARS_COPY.UNNAMED_MEMBER;
    const current = access.access?.associations.find((row) => row.member === member && row.current);
    const invited = access.access?.invitations.find((row) => row.member === member && row.status === 'pending');
    const issueClass = [...holdings.map(({ register }) => register), ...registers].find(
      (register) => register.initialized && register.token.status === 'draft',
    )?.token.uuid;
    const className = (token: string) => {
      const register = registers.find((item) => item.token.uuid === token);
      return register ? `${register.token.name} · ${register.token.symbol}` : 'Share class';
    };
    const absent = <Text style={look.muted}>This shareholder is not on the register of {data.company.name}.</Text>;
    content =
      !holdings.length && !former.length && !recorded ? (
        appointments.isSuccess && appointments.fetchStatus === 'idle' && !authorised ? (
          absent
        ) : (
          privately(data.particulars, 'Their particulars', () => absent)
        )
      ) : (
        <>
          <Section title="Particulars">
            {privately(data.particulars, 'Their particulars', () => (
              <Rows>
                <Fact label="Name">{recorded?.name || title}</Fact>
                <Fact label="Residential address">{recorded?.residentialAddress || 'Not recorded'}</Fact>
              </Rows>
            ))}
            {settled(data.particulars) &&
              (recorded?.followsProfile ? (
                <Text style={look.muted}>{REGISTER_PARTICULARS_COPY.FOLLOWS_PROFILE}</Text>
              ) : (
                edit &&
                (holdings.length > 0 || recorded?.onRegister === false) && (
                  <Action
                    label={REGISTER_PARTICULARS_COPY.PREPARE}
                    onPress={() => {
                      try {
                        guardEdit();
                        setNavigationError(false);
                        navigation.navigate('ShareholderParticulars', { company, member });
                      } catch {
                        setNavigationError(true);
                      }
                    }}
                  />
                )
              ))}
            {navigationError && (
              <Text accessibilityRole="alert" style={styles.error}>
                Refresh the register and your current appointment before changing particulars.
              </Text>
            )}
            {!!outcome && <Outcome>{outcome}</Outcome>}
          </Section>
          <Section title="Holdings">
            {!holdings.length && <Text style={look.muted}>No current holding.</Text>}
            {holdings.map(({ register, holder }, index) => (
              <View key={register.token.uuid} style={[look.stack, index > 0 && look.group]}>
                <Text accessibilityRole="header" style={look.heading}>
                  {register.token.name} · {register.token.symbol}
                </Text>
                <Rows>
                  {[
                    ['Shares held', formatShareCount(holder.balance)],
                    ['% of class', sharePercentage(holder.balance, register.issuedSupply)],
                    ['Date added', formatDate(holder.enteredOn, 'Not recorded')],
                    ['Holder type', HOLDER_TYPE_LABELS[holder.holderType]],
                    ...(holder.name && holder.name !== title ? [['Name for this class', holder.name]] : []),
                  ].map(([label, value]) => (
                    <Fact key={label} label={label}>
                      {value}
                    </Fact>
                  ))}
                </Rows>
                {holder.holderType === 'ambiguous' && <Text style={look.muted}>{REGISTER_COPY.AMBIGUOUS_NOTE}</Text>}
                {holder.holderType === 'unidentified' && (
                  <Text style={look.muted}>{REGISTER_COPY.UNIDENTIFIED_NOTE}</Text>
                )}
              </View>
            ))}
            {former.map(({ register, row }) => (
              <Text key={`${register.token.uuid}/${row.uuid}`} style={look.muted}>
                {register.token.name} · {shareCount(row.sharesAtCessation)}, ceased{' '}
                {formatDate(row.ceasedOn, 'Not recorded')}
                {row.returnedOn ? ` · returned ${formatDate(row.returnedOn)}` : ''}
                {row.correctedBy ? ' · cessation corrected' : ''}
              </Text>
            ))}
            {prepare && issueClass && recorded?.walletless && recorded.particularsRetained && (
              <Action
                label="Issue shares to them"
                onPress={() => navigation.navigate('IssueShares', { company, token: issueClass, member })}
              />
            )}
            {former.some(({ register }) => register.formerMembersStale) && (
              <Text style={look.muted}>The former-member history needs a refresh before relying on it.</Text>
            )}
          </Section>
          <Section title="History">
            {privately(data.entries, 'Their history', () =>
              data.entries.data?.length ? (
                <Rows>
                  {data.entries.data.map(({ token, entry }) => (
                    <View key={entry.uuid} style={[look.line, look.row]}>
                      <Text style={[look.text, look.fill]}>
                        {formatDate(entry.effectiveOn)} · {className(token)} ·{' '}
                        {REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind]}
                      </Text>
                      <Text style={look.figure}>
                        {signedShares(
                          entry.changes
                            .filter((change) => change.member === member)
                            .reduce((sum, change) => sum + BigInt(change.shares), 0n),
                        )}{' '}
                        shares
                      </Text>
                    </View>
                  ))}
                </Rows>
              ) : (
                <Text style={look.muted}>No changes yet.</Text>
              ),
            )}
          </Section>
          {authorised && data.awards.isError && (
            <Section title="Employee awards">
              <LoadError retry={() => data.awards.refetch()} busy={data.awards.isFetching}>
                Employee awards could not be loaded.
              </LoadError>
            </Section>
          )}
          {settled(data.awards) && !!data.awards.data?.length && (
            <Section title="Employee awards">
              <View accessibilityLabel="Employee awards">
                <Rows>
                  {data.awards.data.map((award) => (
                    <LinkRow
                      key={award.uuid}
                      label={className(award.token)}
                      accessibilityLabel={`${className(award.token)} (employee award, agreement ${formatDate(award.termsOn)})`}
                      onPress={() =>
                        navigation.navigate('EmployeeAward', { company, token: award.token, award: award.uuid })
                      }
                    >
                      <Text style={look.small}>Agreement {formatDate(award.termsOn)}</Text>
                      <Text style={look.small}>
                        {formatShareCount(award.shares)} promised · {formatShareCount(award.vestedShares)} vested ·{' '}
                        {formatShareCount(award.issuedShares)} issued
                      </Text>
                    </LinkRow>
                  ))}
                </Rows>
              </View>
              <Action label="Open Employee share scheme" onPress={() => navigation.navigate('EmployeeScheme')} />
            </Section>
          )}
          {access.access && (
            <Section title="Access to their own records">
              <Text style={look.text}>
                {current
                  ? 'They can see their own holdings and history.'
                  : invited
                    ? `Invited, waiting for them to accept until ${formatDateTime(invited.acceptanceDeadline)}.`
                    : 'No access yet. An invitation lets them see their own holdings and history.'}
              </Text>
              {!current && !invited && (
                <Action
                  label="Invite to their records"
                  onPress={() => navigation.navigate('MemberAccess', { company, inviteMember: member })}
                />
              )}
            </Section>
          )}
        </>
      );
  }
  return (
    <Page
      testID="shareholder-scroll"
      title={title}
      refreshControl={
        <RefreshControl
          testID="shareholder-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing) return;
            setRefreshing(true);
            void Promise.all([
              data.classes.refetch(),
              ...(data.tokens.length
                ? [
                    data.registers.refetch(),
                    data.particulars.refetch(),
                    data.entries.refetch(),
                    data.awards.refetch(),
                    appointments.refetch(),
                  ]
                : []),
              ...(access.canAdminister ? [access.refresh()] : []),
            ]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {content}
    </Page>
  );
}
