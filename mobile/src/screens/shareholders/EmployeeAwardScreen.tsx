import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, Text } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_AWARD_COPY as COPY,
  USER_PREFERENCES_QUERY_KEY,
  allPeopleKey,
  appointmentForRegisterStep,
  awardEndsKey,
  awardVestingReversalsKey,
  awardVestingsKey,
  awardsKey,
  grantsKey,
  hasCurrentRegisterReadAuthority,
  registerKey,
  useOwnAppointments,
  useRegisterAward,
  useRegisterClasses,
  useRegisterGrants,
  useRegisters,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Actions, LoadError, Loading } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import { AwardRecord } from './AwardRecord';
import { useShareholderStyles } from './useShareholderStyles';

const TITLE = DESTINATIONS.companyRegisterAward.title;

export function EmployeeAwardScreen({ route }: { route: RouteProp<SignedInStackParamList, 'EmployeeAward'> }) {
  const { company, token, award } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  const scope = useRetainedScope(
    owner,
    boundary.get,
    `${company}/${token}/${award}`,
    !preferences.isError &&
      !preferences.isFetching &&
      readable &&
      !directory.hasError &&
      !directory.isLoading &&
      !directory.isRefreshing,
  );
  if (owner && scope.scope !== undefined)
    return (
      <OwnAward
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${token}/${award}`}
        owner={owner}
        currentOwner={scope.currentOwner}
        accountOwner={boundary.get}
        available={scope.available}
        company={company}
        token={token}
        uuid={award}
      />
    );
  return (
    <Page testID="employee-award-scroll" title={TITLE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnAward({
  owner,
  currentOwner,
  accountOwner,
  available,
  company,
  token,
  uuid,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accountOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
  token: string;
  uuid: string;
}) {
  const theme = useAppTheme();
  const look = useShareholderStyles();
  const client = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen the register.');
    },
    [owner, currentOwner],
  );
  const accountGuard = useMemo(
    () => () => {
      if (accountOwner() !== owner) throw new Error('Your signed-in account changed. Reopen the register.');
    },
    [owner, accountOwner],
  );
  const preferences = useUserPreferences();
  const classes = useRegisterClasses(owner, accountGuard, orderSubmissionSession, available);
  const listed = classes.data?.find((item) => item.uuid === token);
  const companyMatches = listed?.companyUuid === company;
  const appointments = useOwnAppointments(owner, accountGuard, {
    enabled: companyMatches,
    session: orderSubmissionSession,
  });
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = useMemo(
    () => () => {
      guard();
      if (!live.current) throw new Error('This award is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company],
  );
  const readable =
    available &&
    companyMatches &&
    appointments.isSuccess &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const registers = useRegisters(
    owner,
    companyMatches ? [token] : [],
    guard,
    orderSubmissionSession,
    available && readable,
  );
  const award = useRegisterAward(owner, company, token, uuid, check, readable, orderSubmissionSession);
  const grants = useRegisterGrants(owner, company, token, check, readable, orderSubmissionSession);
  const register = registers.data?.[0];
  const supported = !!register?.initialized && register.token.status === 'draft';
  const appointment = readable ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const [held, setHeld] = useState(false);
  const [editing, setEditing] = useState(false);
  const preferenceState = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const sourceReady =
    available &&
    preferenceState?.status === 'success' &&
    preferenceState.fetchStatus === 'idle' &&
    classes.isSuccess &&
    classes.fetchStatus === 'idle' &&
    registers.isSuccess &&
    registers.fetchStatus === 'idle';
  const blocked =
    !readable || !sourceReady || award.isFetching || award.isError || appointments.isFetching || appointments.isError;
  const visible =
    available &&
    readable &&
    sourceReady &&
    award.isSuccess &&
    !award.isFetching &&
    !appointments.isFetching &&
    !appointments.isError;
  const refresh = async () => {
    check();
    await award.refetch({ throwOnError: true });
    check();
    await Promise.all([
      client.invalidateQueries({ queryKey: awardsKey(owner, token), exact: true }),
      client.invalidateQueries({ queryKey: grantsKey(owner, token) }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'invitation-awards', company] }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'member-awards', company] }),
    ]);
  };

  let content: ReactNode;
  if (preferences.isError)
    content = (
      <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
        Your account could not be loaded.
      </LoadError>
    );
  else if (classes.isError)
    content = (
      <LoadError retry={() => classes.refetch()} busy={classes.isFetching}>
        The register could not be loaded.
      </LoadError>
    );
  else if (!classes.data) content = <Loading>Loading the register…</Loading>;
  else if (!companyMatches)
    content = <Text style={look.muted}>This share class is not in a register you can read.</Text>;
  else if (appointments.isError)
    content = (
      <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
        Your appointments could not be loaded.
      </LoadError>
    );
  else if (!appointments.isSuccess) content = <Loading>Loading your appointments…</Loading>;
  else if (!readable)
    content = (
      <Text style={look.muted}>A current company register appointment is required to read employee awards.</Text>
    );
  else if (registers.isError)
    content = (
      <LoadError retry={() => registers.refetch()} busy={registers.isFetching}>
        The share class could not be loaded.
      </LoadError>
    );
  else if (award.isError)
    content = (
      <LoadError retry={() => award.refetch()} busy={award.isFetching}>
        This employee award could not be loaded.
      </LoadError>
    );
  else if (!visible) content = <Loading>Loading the employee award…</Loading>;
  else content = null;

  const shown = visible ? award.data : undefined;
  return (
    <Page
      testID="employee-award-scroll"
      title={shown ? shown.recipientName : TITLE}
      available={available}
      unavailable={preferences.isError ? content : <RegisterAccess owner={owner} />}
      lede={shown && register ? `Employee award · ${register.token.name} · ${register.token.symbol}` : undefined}
      links={
        shown &&
        !held &&
        !editing && (
          <Actions>
            <Action
              compact
              label="Recipient details"
              accessibilityLabel={`Recipient details (${shown.recipientName})`}
              onPress={() => navigation.navigate('Shareholder', { company, member: shown.member })}
            />
          </Actions>
        )
      }
      refreshControl={
        <RefreshControl
          testID="employee-award-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (!available || refreshing || held || editing) return;
            setRefreshing(true);
            void Promise.all([
              classes.refetch(),
              appointments.refetch(),
              ...(readable
                ? [
                    registers.refetch(),
                    award.refetch(),
                    grants.refetch(),
                    ...[awardVestingsKey, awardEndsKey, awardVestingReversalsKey].map((key) =>
                      client.refetchQueries({ queryKey: key(owner, uuid), exact: true }),
                    ),
                  ]
                : []),
            ]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {content}
      {visible && !appointment && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {visible && grants.isError && (
        <LoadError retry={() => grants.refetch()} busy={grants.isFetching}>
          The non-paid issues prepared from this award could not be loaded.
        </LoadError>
      )}
      {award.data && (
        <AwardRecord
          owner={owner}
          award={award.data}
          grants={grants.isSuccess ? grants.data.filter((grant) => grant.award === uuid) : []}
          appointment={supported ? appointment : undefined}
          guard={check}
          blocked={blocked}
          visible={visible}
          onHeldChange={setHeld}
          onEditingChange={setEditing}
          onSettled={refresh}
        />
      )}
    </Page>
  );
}
