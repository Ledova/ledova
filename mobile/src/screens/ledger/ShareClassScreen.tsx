import { useCallback, useEffect, useState } from 'react';
import { Keyboard, RefreshControl, Text, View } from 'react-native';
import { useNavigation, usePreventRemove, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  classRightsKey,
  formatShareCount,
  memberDocumentsKey,
  ownAppointmentsKey,
  useClassRights,
  useClassDetails,
  useOwnAppointments,
  registerSteps,
  type OrderSubmissionOwner,
  useShareClass,
  useSubmissionOwner,
  useUserPreferences,
} from '@ledova/shared';
import { Fact, LoadError, Loading, Rows, Section, Status } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ClassRights } from './ClassRights';
import { ClassDetails, ClassDetailsActions, ClassDetailsContent } from './ClassDetails';
import { ClassSetup, NewClassSetup } from './ClassSetup';
import { ShareholderDocuments } from '../../components/register/ShareholderDocuments';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyClass.title;

type ShareClass = ReturnType<typeof useShareClass>;

export function ShareClassScreen({
  route,
}: {
  route: RouteProp<SignedInStackParamList, 'ShareClass' | 'RegisterSetup'>;
}) {
  const { company, token, record, from } = route.params;
  const flow = useClassFlow(company, token, from);
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  const scope = useRetainedScope(
    owner,
    boundary.get,
    `${company}/${token ?? 'new'}`,
    !preferences.isError &&
      !preferences.isFetching &&
      readable &&
      !directory.hasError &&
      !directory.isLoading &&
      !directory.isRefreshing,
  );
  if (owner && scope.scope !== undefined)
    return token ? (
      <OwnShareClass
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${token}`}
        owner={owner}
        company={company}
        token={token}
        record={record}
        requested={route.name === 'RegisterSetup' || !!record}
        available={scope.available}
        flow={flow}
      />
    ) : (
      <NewClassSetup
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}`}
        owner={owner}
        currentOwner={scope.currentOwner}
        accountOwner={boundary.get}
        available={scope.available}
        company={company}
        {...flow}
      />
    );
  return (
    <Page testID="share-class-scroll" title={TITLE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function useClassFlow(company: string, token?: string, from?: 'IssueShares' | 'TransferShares' | 'Corrections') {
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const open = (place: 'Ledger' | 'IssueShares' | 'TransferShares' | 'Corrections') => {
    Keyboard.dismiss();
    const listed = !!navigation.getState()?.routes.some(({ name }) => name === place);
    if (place === 'Ledger') {
      if (listed) navigation.popTo(place);
      else navigation.replace(place);
    } else {
      const params = { company, token: token ?? '' };
      if (listed) navigation.popTo(place, params);
      else navigation.replace(place, params);
    }
  };
  return {
    onCancel: () => open(from ?? 'Ledger'),
    onOpen: open,
    onContinue: (started: string) => navigation.replace('ShareClass', { company, token: started }),
    onPrepared: (prepared: string, saved: string) => {
      if (token) navigation.setParams({ token: prepared, record: saved });
      else navigation.replace('ShareClass', { company, token: prepared, record: saved });
    },
    onFinished: () => navigation.popTo('Dashboard'),
  };
}

function OwnShareClass({
  owner,
  company,
  token,
  record,
  requested,
  available,
  flow,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  token: string;
  record?: string;
  requested: boolean;
  available: boolean;
  flow: ReturnType<typeof useClassFlow>;
}) {
  const look = useLedgerStyles();
  const data = useShareClass(token, orderSubmissionSession, available);
  if (data.token.data && data.token.data.companyUuid !== company)
    return (
      <Page testID="share-class-scroll" title={TITLE}>
        <Text style={look.muted}>This share class is not in a register you can read.</Text>
      </Page>
    );
  return (
    <ClassPage
      data={data}
      owner={owner}
      company={company}
      token={token}
      record={record}
      requested={requested}
      available={available}
      flow={flow}
    />
  );
}

function ClassPage({
  data,
  owner,
  company,
  token,
  record,
  requested,
  available,
  flow,
}: {
  data: ShareClass;
  owner: OrderSubmissionOwner;
  company: string;
  token: string;
  record?: string;
  requested: boolean;
  available: boolean;
  flow: ReturnType<typeof useClassFlow>;
}) {
  const theme = useAppTheme();
  const look = useLedgerStyles();
  const client = useQueryClient();
  const preferences = useUserPreferences();
  const preferencesRead = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const [refreshing, setRefreshing] = useState(false);
  const { holdReads } = data;
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const appointments = useOwnAppointments(owner, data.guard, {
    enabled: available && data.token.isSuccess,
    session: orderSubmissionSession,
  });
  const [setup, setSetup] = useState<boolean | null>(null);
  const [setupHeld, setSetupHeld] = useState(false);
  const [detailsHeld, setDetailsHeld] = useState(false);
  const [deleted, setDeleted] = useState<string | null>(null);
  const ready =
    available &&
    data.token.isSuccess &&
    data.token.fetchStatus === 'idle' &&
    data.register.isSuccess &&
    data.register.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle';
  const steps = data.token.data && appointments.data ? registerSteps(appointments.data, company) : null;
  const canSetUp = !!(steps?.prepare || steps?.approve || steps?.apply);
  if (setup === null && ready) setSetup(canSetUp && (requested || !data.register.data?.initialized));
  const heldSetup = useCallback(
    (held: boolean) => {
      setSetupHeld(held);
      holdReads('class-setup', held);
    },
    [holdReads],
  );
  const heldDetails = useCallback(
    (held: boolean) => {
      setDetailsHeld(held);
      holdReads('class-details', held);
    },
    [holdReads],
  );
  const detailsAvailable = ready && !setupHeld && (!data.readingPaused || detailsHeld);
  const details = useClassDetails(data, owner, detailsAvailable, heldDetails, {
    session: orderSubmissionSession,
    release: (update) => update(),
    onDeleted: (_, confirmed) =>
      setDeleted(
        confirmed ? 'Share class deleted.' : 'This share class is no longer available. Deletion was not confirmed.',
      ),
  });
  usePreventRemove(details.busy || details.pending, () => {});
  useEffect(() => {
    if (deleted && !details.busy && !details.pending) navigation.popTo('Ledger', { outcome: deleted });
  }, [deleted, details.busy, details.pending, navigation]);
  const recordsChanged = useCallback(() => {
    void data.token.refetch();
  }, [data.token.refetch]);
  const classDetailsVisible = !!(
    data.token.data?.canEditDetails ||
    data.token.data?.canDelete ||
    data.token.data?.deletionBlockedReason ||
    details.held ||
    details.outcome
  );
  const listed = data.token.data;
  const rights = useClassRights(
    token,
    available && data.token.isSuccess && data.token.fetchStatus === 'idle' && !setupHeld && !detailsHeld,
    listed?.companyUuid,
    SHARE_SHEET_FILES,
    randomUUID,
    orderSubmissionSession,
  );
  useEffect(() => {
    holdReads('class-rights', !!rights.editor || rights.pending || rights.busy);
    return () => holdReads('class-rights', false);
  }, [rights.editor, rights.pending, rights.busy, holdReads]);
  const onDocumentsHeld = useCallback((held: boolean) => holdReads('member-documents', held), [holdReads]);
  const registerReady =
    available &&
    !!preferences.preferences &&
    preferencesRead?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.token.isSuccess &&
    data.token.fetchStatus === 'idle' &&
    data.register.isSuccess &&
    data.register.fetchStatus === 'idle';
  const register = registerReady ? data.register.data : undefined;
  const sourceError = data.token.isError || data.register.isError || appointments.isError;
  const refresh = async () => {
    if (!owner) return;
    if (preferences.isError) await preferences.refetch();
    const read = await data.token.refetch();
    if (!read.isSuccess) return;
    await data.register.refetch();
    await client.invalidateQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
    await Promise.all([
      client.invalidateQueries({ queryKey: classRightsKey(owner, token) }),
      client.invalidateQueries({ queryKey: memberDocumentsKey(owner, read.data.companyUuid) }),
    ]);
  };
  return (
    <Page
      testID="share-class-scroll"
      title={available ? (listed?.name ?? TITLE) : TITLE}
      available={available}
      held={details.busy || details.pending}
      unavailable={<RegisterAccess owner={owner} />}
      refreshControl={
        <RefreshControl
          testID="share-class-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (!available || refreshing || data.readingPaused) return;
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {setup === false && listed && classDetailsVisible && (
        <View style={sourceError && look.hidden}>
          <ClassDetails token={listed} details={details} available={detailsAvailable} />
        </View>
      )}
      {data.token.isPending ? (
        <Loading>Loading the share class…</Loading>
      ) : data.token.isError || !listed ? (
        <LoadError retry={() => data.token.refetch()} busy={data.token.isFetching}>
          This share class could not be loaded. It may be unavailable to this account.
        </LoadError>
      ) : setup !== false && data.register.isError ? (
        <LoadError retry={() => data.register.refetch()} busy={data.register.isFetching}>
          The current ownership could not be loaded.
        </LoadError>
      ) : setup !== false && appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your class setup access could not be loaded.
        </LoadError>
      ) : setup === null ? (
        <Loading>Loading the share class…</Loading>
      ) : setup ? null : (
        <Section title="Summary">
          {requested && !canSetUp && <Text style={look.muted}>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</Text>}
          {!classDetailsVisible && (
            <Text style={look.muted}>
              {listed.symbol} · {listed.tokenTypeDisplay}
            </Text>
          )}
          {preferencesRead?.status === 'error' ? (
            <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
              Your account could not be loaded.
            </LoadError>
          ) : data.register.isError ? (
            <LoadError retry={() => data.register.refetch()} busy={data.register.isFetching}>
              The current ownership could not be loaded.
            </LoadError>
          ) : !register ? (
            <Loading>Loading current ownership…</Loading>
          ) : (
            <View accessibilityLabel="Current ownership" style={look.stack}>
              <Rows>
                <Fact inline label="Issued shares">
                  {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
                </Fact>
                <Fact inline label="Current shareholders">
                  {register.initialized ? formatShareCount(String(register.totalHolders)) : 'Not recorded'}
                </Fact>
                {listed.totalSupply !== TECHNICAL_SHARE_LIMIT && (
                  <Fact inline label="Authorised shares">
                    {formatShareCount(listed.totalSupply)}
                  </Fact>
                )}
              </Rows>
              {!register.initialized && (
                <Status tone="waiting" muted>
                  Ledger not opened
                </Status>
              )}
              {!listed.isTransferable && (
                <Text style={look.muted}>This share class is recorded as non-transferable.</Text>
              )}
              {!register.initialized ? (
                <Text style={look.muted}>{REGISTER_COPY.NOT_OPENED_NOTE}</Text>
              ) : register.waitingEffects === null ? (
                <Text accessibilityLiveRegion="polite" style={look.muted}>
                  {REGISTER_COPY.WAITING_UNKNOWN_NOTE}
                </Text>
              ) : register.waitingEffects > 0 ? (
                <Text accessibilityLiveRegion="polite" style={look.muted}>
                  {REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}
                </Text>
              ) : null}
            </View>
          )}
        </Section>
      )}
      {setup === true && listed && (
        <View style={sourceError && look.hidden}>
          <ClassSetup
            owner={owner}
            currentOwner={() => {
              data.guard();
              return owner;
            }}
            accountOwner={() => {
              data.accountGuard();
              return owner;
            }}
            available={available && !sourceError}
            company={company}
            token={token}
            record={record}
            externalHeld={data.readingPaused && !setupHeld && !detailsHeld && !details.held}
            classHeld={details.held}
            classFields={(recordFields) => (
              <ClassDetailsContent token={listed} details={details} available={detailsAvailable}>
                {recordFields}
              </ClassDetailsContent>
            )}
            classActions={<ClassDetailsActions token={listed} details={details} available={detailsAvailable} />}
            onHeldChange={heldSetup}
            onRecordsChanged={recordsChanged}
            {...flow}
          />
        </View>
      )}
      <ClassRights rights={rights} />
      {listed && owner && (
        <ShareholderDocuments
          readsPaused={data.readingPaused}
          onHeldChange={onDocumentsHeld}
          owner={owner}
          accountGuard={data.accountGuard}
          guard={data.guard}
          company={listed.companyUuid}
          token={listed.uuid}
          sourceReady={registerReady}
          holdings={(data.register.data?.holders ?? []).map((holder) => ({
            member: holder.member,
            token: listed.uuid,
            label: holder.name || 'Unnamed shareholder',
          }))}
        />
      )}
    </Page>
  );
}
