import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_TRANSFER_COPY as COPY,
  allPeopleKey,
  entriesKey,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  registerHoldersKey,
  registerSteps,
  transfersKey,
  useOwnAppointments,
  useRegisterTransfers,
  useSubmissionOwner,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Actions, LoadError, Loading, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { TransferRecord } from './TransferRecord';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyRegister.tasks.transfer;
const LEDE = 'Record a transfer between shareholders.';

type Landing = SignedInStackParamList['TransferShares'];

export function TransferSharesScreen({ route }: { route: RouteProp<SignedInStackParamList, 'TransferShares'> }) {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing)
    return (
      <CompanyTransfers
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
        landing={route.params?.company === company.uuid ? route.params : undefined}
      />
    );
  return (
    <Page testID="transfer-shares-scroll" title={TITLE} lede={LEDE}>
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

function CompanyTransfers({
  owner,
  currentOwner,
  company,
  landing,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  landing: Landing;
}) {
  const theme = useAppTheme();
  const look = useLedgerStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const page = useRef<ScrollView>(null);
  const content = useRef<View>(null!);
  const source = useCompanyRegisters(owner, currentOwner, company, TITLE);
  const [chosen, setChosen] = useState(landing?.token ?? '');
  const [answered, setAnswered] = useState(landing);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kept, setKept] = useState<TokenHoldersResponse[]>([]);
  const refreshTransfers = useRef<() => Promise<unknown>>(async () => undefined);
  if (landing !== answered) {
    setAnswered(landing);
    if (landing?.token && !busy) setChosen(landing.token);
  }
  if (source.registers && source.registers.length > 0 && source.registers !== kept) setKept(source.registers);
  const registers = source.registers ?? (busy ? kept : []);
  const register = registers.find(({ token }) => token.uuid === chosen) ?? registers[0];
  const toTop = useCallback(() => page.current?.scrollTo({ y: 0, animated: false }), []);
  const focusRecord = useCallback((record: View) => {
    if (!content.current) return;
    try {
      record.measureLayout(
        content.current,
        (_left, top) => page.current?.scrollTo({ y: top, animated: false }),
        () => undefined,
      );
    } catch {
      return;
    }
  }, []);
  return (
    <Page
      ref={page}
      innerViewRef={content}
      testID="transfer-shares-scroll"
      title={TITLE}
      lede={LEDE}
      titleAction={
        source.sourceReady && registers.length > 1 && register ? (
          <FilterPopover>
            {(close) => (
              <SelectField
                label="Share class"
                options={registers.map(({ token }) => ({
                  value: token.uuid,
                  label: `${token.name} · ${token.symbol}`,
                }))}
                value={register.token.uuid}
                disabled={busy}
                onChange={(token) => {
                  if (busy || !source.sourceReady) return;
                  close();
                  setChosen(token);
                }}
              />
            )}
          </FilterPopover>
        ) : undefined
      }
      refreshControl={
        <RefreshControl
          testID="transfer-shares-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || busy) return;
            setRefreshing(true);
            void Promise.all([source.retry(), refreshTransfers.current()]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {source.accountError ? (
        <LoadError retry={source.retryAccount} busy={source.isRefreshing}>
          Your account could not be loaded.
        </LoadError>
      ) : source.hasError || source.invalid ? (
        <LoadError retry={source.retry} busy={source.isRefreshing}>
          The register could not be loaded.
        </LoadError>
      ) : !source.sourceReady && !register ? (
        <Loading>Loading the register…</Loading>
      ) : null}
      {source.sourceReady && register && (
        <Text style={look.muted}>
          {register.token.name} · {register.token.symbol}
        </Text>
      )}
      {register && (
        <ClassTransfers
          key={`${company}/${register.token.uuid}`}
          owner={owner}
          company={company}
          register={register}
          guard={source.guard}
          sourceReady={source.sourceReady}
          landing={landing?.token === register.token.uuid ? landing : undefined}
          refreshRef={refreshTransfers}
          onBusyChange={setBusy}
          onOpen={toTop}
          onFocusRecord={focusRecord}
          onPrepare={() => navigation.navigate('TransferPreparation', { company, token: register.token.uuid })}
        />
      )}
    </Page>
  );
}

function ClassTransfers({
  owner,
  company,
  register,
  guard,
  sourceReady,
  landing,
  refreshRef,
  onBusyChange,
  onOpen,
  onFocusRecord,
  onPrepare,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  landing: Landing;
  refreshRef: RefObject<() => Promise<unknown>>;
  onBusyChange: (busy: boolean) => void;
  onOpen: () => void;
  onFocusRecord: (record: View) => void;
  onPrepare: () => void;
}) {
  const card = useCardStyles();
  const look = useLedgerStyles();
  const client = useQueryClient();
  const token = register.token.uuid;
  const source = useRef(sourceReady);
  useLayoutEffect(() => {
    source.current = sourceReady;
  }, [sourceReady]);
  const appointments = useOwnAppointments(owner, guard, { session: orderSubmissionSession });
  const readable = appointments.isSuccess && hasCurrentRegisterReadAuthority(appointments.data, company);
  const check = useMemo(
    () => () => {
      guard();
      const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      if (
        !source.current ||
        state?.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        !hasCurrentRegisterReadAuthority(state.data ?? [], company)
      )
        throw new Error('Refresh the register and your current company appointment.');
    },
    [client, owner, company, guard],
  );
  const transfers = useRegisterTransfers(owner, company, token, check, readable && sourceReady, orderSubmissionSession);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    sourceReady &&
    readable &&
    appointments.fetchStatus === 'idle' &&
    transfers.isSuccess &&
    transfers.fetchStatus === 'idle';
  const privateGuard = () => {
    check();
    const state = client.getQueryState(transfersKey(owner, token));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the share transfers before continuing.');
  };
  const [reviewing, setReviewing] = useState<string | null>(null);
  const reviewChanged = useCallback((uuid: string, open: boolean) => {
    setReviewing((current) => (open ? uuid : current === uuid ? null : current));
  }, []);
  const [heldRecords, setHeldRecords] = useState<ReadonlySet<string>>(() => new Set());
  const recordHeld = useCallback((uuid: string, held: boolean) => {
    setHeldRecords((current) => {
      if (current.has(uuid) === held) return current;
      const next = new Set(current);
      if (held) next.add(uuid);
      else next.delete(uuid);
      return next;
    });
  }, []);
  const held = heldRecords.size > 0;
  const open = !!reviewing;
  useEffect(() => {
    onBusyChange(open || held);
  }, [onBusyChange, open, held]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);
  const refresh = async () => {
    guard();
    await appointments.refetch({ throwOnError: true });
    check();
    await transfers.refetch({ throwOnError: true });
    check();
    await Promise.all(
      [allPeopleKey(owner), registerHoldersKey(owner), entriesKey(owner, token)].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
  };
  useLayoutEffect(() => {
    refreshRef.current = async () => {
      guard();
      await client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
      const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      if (state?.status !== 'success' || !hasCurrentRegisterReadAuthority(state.data ?? [], company)) return;
      await transfers.refetch({ cancelRefetch: false });
    };
  });
  const supported = register.initialized && register.token.status === 'draft';
  const records = transfers.data ?? [];
  const browsing = !reviewing;
  const prepareAction =
    privateReady && steps?.prepare && supported ? (
      <Action label={COPY.PREPARE} disabled={held} onPress={onPrepare} />
    ) : null;
  return (
    <View style={reviewing ? undefined : card.card}>
      {browsing && (
        <Text accessibilityRole="header" style={card.title}>
          Share transfers
        </Text>
      )}
      {!supported && sourceReady && (
        <Text style={look.muted}>
          {register.token.status === 'draft'
            ? 'Set up this share register before recording a transfer.'
            : 'Transfers for a class that uses the chain aren’t available in the app.'}
        </Text>
      )}
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {steps && !Object.values(steps).some(Boolean) && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {appointments.isError ? null : !appointments.isSuccess ||
        appointments.isFetching ||
        !sourceReady ||
        (readable && (transfers.isPending || transfers.isFetching)) ? (
        <Loading>Loading non-paid transfers…</Loading>
      ) : !readable ? (
        <Text style={look.muted}>A current company register appointment is required to read share transfers.</Text>
      ) : transfers.isError ? (
        <LoadError retry={() => refresh().catch(() => {})} busy={transfers.isFetching || appointments.isFetching}>
          Transfers could not be loaded.
        </LoadError>
      ) : privateReady && records.length === 0 ? (
        <Text style={look.muted}>{COPY.EMPTY}</Text>
      ) : null}
      <View accessibilityLabel="Share transfers">
        {records.map((transfer, index) => (
          <TransferRecord
            key={transfer.uuid}
            transfer={transfer}
            steps={steps ?? {}}
            guard={privateGuard}
            visible={privateReady}
            focusKey={landing?.record === transfer.uuid ? transfer.uuid : undefined}
            onFocus={onFocusRecord}
            outcome={landing?.record === transfer.uuid ? landing.outcome : undefined}
            prepareAction={index === records.length - 1 ? prepareAction : undefined}
            onHeldChange={recordHeld}
            onSettled={refresh}
            reviewing={reviewing}
            onReviewChange={reviewChanged}
            ruled={index > 0}
          />
        ))}
      </View>
      {records.length === 0 && prepareAction && <Actions>{prepareAction}</Actions>}
    </View>
  );
}
