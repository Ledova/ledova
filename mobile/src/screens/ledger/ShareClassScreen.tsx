import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  REGISTER_COPY,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  classRightsKey,
  formatShareCount,
  memberDocumentsKey,
  ownAppointmentsKey,
  useClassRights,
  useShareClass,
  useSubmissionOwner,
  useUserPreferences,
} from '@ledova/shared';
import { Fact, LoadError, Loading, Rows, Section, Status } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ClassRights } from './ClassRights';
import { ShareholderDocuments } from './ShareholderDocuments';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyClass.title;

type ShareClass = ReturnType<typeof useShareClass>;

export function ShareClassScreen({ route }: { route: RouteProp<SignedInStackParamList, 'ShareClass'> }) {
  const { company, token } = route.params;
  const { owner } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  if (owner && readable && !directory.hasError && !directory.isLoading)
    return (
      <OwnShareClass
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${token}`}
        company={company}
        token={token}
      />
    );
  return (
    <Page testID="share-class-scroll" title={TITLE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnShareClass({ company, token }: { company: string; token: string }) {
  const look = useLedgerStyles();
  const data = useShareClass(token, orderSubmissionSession);
  if (data.token.data && data.token.data.companyUuid !== company)
    return (
      <Page testID="share-class-scroll" title={TITLE}>
        <Text style={look.muted}>This share class is not in a register you can read.</Text>
      </Page>
    );
  return <ClassPage data={data} token={token} />;
}

function ClassPage({ data, token }: { data: ShareClass; token: string }) {
  const theme = useAppTheme();
  const look = useLedgerStyles();
  const client = useQueryClient();
  const preferences = useUserPreferences();
  const preferencesRead = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const [refreshing, setRefreshing] = useState(false);
  const { holdReads, owner } = data;
  const listed = data.token.data;
  const rights = useClassRights(
    token,
    data.token.isSuccess && data.token.fetchStatus === 'idle',
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
    !!preferences.preferences &&
    preferencesRead?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.token.isSuccess &&
    data.token.fetchStatus === 'idle' &&
    data.register.isSuccess &&
    data.register.fetchStatus === 'idle';
  const register = registerReady ? data.register.data : undefined;
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
      title={listed?.name ?? TITLE}
      refreshControl={
        <RefreshControl
          testID="share-class-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || data.readingPaused) return;
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {data.token.isPending ? (
        <Loading>Loading the share class…</Loading>
      ) : data.token.isError || !listed ? (
        <LoadError retry={() => data.token.refetch()} busy={data.token.isFetching}>
          This share class could not be loaded. It may be unavailable to this account.
        </LoadError>
      ) : (
        <Section title="Summary">
          <Text style={look.muted}>
            {listed.symbol} · {listed.tokenTypeDisplay}
          </Text>
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
      <ClassRights rights={rights} />
      {listed && owner && (
        <ShareholderDocuments
          readsPaused={data.readingPaused}
          onHeldChange={onDocumentsHeld}
          owner={owner}
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
