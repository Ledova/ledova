import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY as COPY,
  REGISTER_IMPORT_COPY,
  allPeopleKey,
  correctionsKey,
  entriesKey,
  entryLabel,
  hasCurrentRegisterReadAuthority,
  importsKey,
  ownAppointmentsKey,
  registerHoldersKey,
  registerSteps,
  useClassCorrections,
  useOwnAppointments,
  useRegisterEntries,
  useRegisterImports,
  useSubmissionOwner,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, LoadError, LoadMore, Loading, Section, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ClassEntries } from './ClassEntries';
import { CorrectionRecord } from './CorrectionRecord';
import { ImportRecord } from './ImportRecord';
import { ParticularsChanges } from './ParticularsChanges';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyRegister.tasks.corrections;
const LEDE = 'Prepare and review changes while preserving the original records.';

type Landing = SignedInStackParamList['Corrections'];

export function CorrectionsScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Corrections'> }) {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing)
    return (
      <CompanyCorrections
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
        landing={route.params?.company === company.uuid ? route.params : undefined}
      />
    );
  return (
    <Page testID="corrections-scroll" title={TITLE} lede={LEDE}>
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

function CompanyCorrections({
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
  const client = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const page = useRef<ScrollView>(null);
  const content = useRef<View>(null!);
  const source = useCompanyRegisters(owner, currentOwner, company, TITLE);
  const [chosen, setChosen] = useState(landing?.token ?? '');
  const [answered, setAnswered] = useState(landing);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kept, setKept] = useState<TokenHoldersResponse[]>([]);
  const refreshClass = useRef<() => Promise<unknown>>(async () => undefined);
  const refreshParticulars = useRef<() => Promise<unknown>>(async () => undefined);
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
  const refreshRecords = async () => {
    source.guard();
    await client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
    const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    if (state?.status !== 'success' || !hasCurrentRegisterReadAuthority(state.data ?? [], company)) return;
    await Promise.allSettled([refreshClass.current(), refreshParticulars.current()]);
  };
  return (
    <Page
      ref={page}
      innerViewRef={content}
      testID="corrections-scroll"
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
          testID="corrections-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || busy) return;
            setRefreshing(true);
            void Promise.all([source.retry(), refreshRecords()])
              .catch(() => undefined)
              .finally(() => setRefreshing(false));
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
        <ClassCorrections
          key={`${company}/${register.token.uuid}`}
          owner={owner}
          company={company}
          register={register}
          guard={source.guard}
          sourceReady={source.sourceReady}
          landing={landing?.token === register.token.uuid ? landing : undefined}
          refreshRef={refreshClass}
          onBusyChange={setBusy}
          onReviewChange={setReviewing}
          onOpen={toTop}
          onFocusRecord={focusRecord}
          onCorrect={(entry) =>
            navigation.navigate('CorrectionPreparation', { company, token: register.token.uuid, entry })
          }
        />
      )}
      {registers.length > 0 && (
        <ParticularsChanges
          owner={owner}
          company={company}
          registers={registers}
          guard={source.guard}
          sourceReady={source.sourceReady}
          hidden={reviewing}
          refreshRef={refreshParticulars}
        />
      )}
    </Page>
  );
}

function ClassCorrections({
  owner,
  company,
  register,
  guard,
  sourceReady,
  landing,
  refreshRef,
  onBusyChange,
  onReviewChange,
  onOpen,
  onFocusRecord,
  onCorrect,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  landing: Landing;
  refreshRef: RefObject<() => Promise<unknown>>;
  onBusyChange: (busy: boolean) => void;
  onReviewChange: (open: boolean) => void;
  onOpen: () => void;
  onFocusRecord: (record: View) => void;
  onCorrect: (entry: string) => void;
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
  const enabled = readable && !appointments.isFetching && sourceReady;
  const history = useRegisterEntries(owner, token, check, enabled, orderSubmissionSession);
  const corrections = useClassCorrections(owner, token, check, enabled, orderSubmissionSession);
  const imports = useRegisterImports(owner, token, check, enabled, orderSubmissionSession);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const readOnly = !!steps && !Object.values(steps).some(Boolean);
  const settled = sourceReady && readable && appointments.fetchStatus === 'idle';
  const entriesReady = settled && !history.isPending && !history.hasError && !history.isFetching;
  const correctionsReady = settled && corrections.isSuccess && corrections.fetchStatus === 'idle';
  const importsReady = settled && imports.isSuccess && imports.fetchStatus === 'idle';
  const settledGuard = (queryKey: readonly unknown[], noun: string) => () => {
    check();
    const state = client.getQueryState(queryKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error(`Refresh the ${noun} before continuing.`);
  };
  const correctionGuard = settledGuard(correctionsKey(owner, token), 'corrections');
  const importGuard = settledGuard(importsKey(owner, token), 'opening records');
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
  useEffect(() => {
    onReviewChange(open);
  }, [onReviewChange, open]);
  useEffect(
    () => () => {
      onBusyChange(false);
      onReviewChange(false);
    },
    [onBusyChange, onReviewChange],
  );
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);
  const refresh = async () => {
    guard();
    await appointments.refetch({ throwOnError: true });
    check();
    await corrections.refetch({ throwOnError: true });
    check();
    await Promise.all(
      [allPeopleKey(owner), registerHoldersKey(owner), entriesKey(owner, token)].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
  };
  useLayoutEffect(() => {
    refreshRef.current = () =>
      Promise.allSettled([
        client.refetchQueries({ queryKey: entriesKey(owner, token), exact: true }),
        corrections.refetch({ cancelRefetch: false }),
        imports.refetch({ cancelRefetch: false }),
      ]);
  });
  const records = corrections.data ?? [];
  const browsing = !reviewing;
  return (
    <>
      <View style={reviewing ? undefined : card.card}>
        {browsing && (
          <Text accessibilityRole="header" style={card.title}>
            Changes
          </Text>
        )}
        <View style={[look.stack, !browsing && look.hidden]}>
          {appointments.isError && (
            <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
              Your appointments could not be loaded.
            </LoadError>
          )}
          {appointments.isError ? null : !appointments.isSuccess ||
            appointments.isFetching ||
            !sourceReady ||
            (readable && (history.isPending || (history.isFetching && !history.isLoadingMore))) ? (
            <Loading>Loading register entries…</Loading>
          ) : !readable ? (
            <Text style={look.muted}>A current company register appointment is required to read register entries.</Text>
          ) : history.hasError ? (
            <LoadError retry={history.retry} busy={history.isFetching}>
              Register entries could not be loaded.
            </LoadError>
          ) : entriesReady && history.entries.length === 0 ? (
            <Text style={look.muted}>No changes recorded yet.</Text>
          ) : null}
          <ClassEntries
            entries={history.entries}
            visible={entriesReady}
            renderAction={(entry) =>
              entriesReady && !history.moreFailed && correctionsReady && steps?.prepare && entry.correctable ? (
                <Action
                  label="Correct"
                  accessibilityLabel={`Correct (${entryLabel(entry)})`}
                  disabled={held}
                  onPress={() => onCorrect(entry.uuid)}
                />
              ) : null
            }
          />
          {readable && (
            <LoadMore
              noun="register entries"
              hasMore={history.hasMore}
              failed={history.moreFailed}
              loading={history.isLoadingMore}
              disabled={!entriesReady}
              onLoad={history.loadMore}
            />
          )}
        </View>
        <View
          style={
            reviewing
              ? undefined
              : !readable || (corrections.isSuccess && records.length === 0)
                ? look.hidden
                : look.group
          }
        >
          {browsing && (
            <Text accessibilityRole="header" style={look.title}>
              {COPY.TITLE}
            </Text>
          )}
          {browsing && readOnly && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
          {browsing &&
            (corrections.isPending ? (
              <Loading>Loading corrections…</Loading>
            ) : corrections.isError ? (
              <LoadError retry={() => corrections.refetch()} busy={corrections.isFetching}>
                Corrections could not be loaded.
              </LoadError>
            ) : null)}
          <View accessibilityLabel={COPY.TITLE}>
            {records.map((correction, index) => (
              <CorrectionRecord
                key={correction.proposal.uuid}
                correction={correction}
                steps={steps ?? {}}
                guard={correctionGuard}
                visible={correctionsReady}
                focusKey={landing?.record === correction.proposal.uuid ? correction.proposal.uuid : undefined}
                onFocus={onFocusRecord}
                outcome={landing?.record === correction.proposal.uuid ? landing.outcome : undefined}
                onHeldChange={recordHeld}
                onSettled={refresh}
                reviewing={reviewing}
                onReviewChange={reviewChanged}
                ruled={index > 0}
              />
            ))}
          </View>
        </View>
      </View>
      {readable && (
        <View style={reviewing && look.hidden}>
          <Section title="Opening records">
            {readOnly && <Text style={look.muted}>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</Text>}
            {imports.isPending ? (
              <Loading>Loading imports…</Loading>
            ) : imports.isError ? (
              <LoadError retry={() => imports.refetch()} busy={imports.isFetching}>
                Imports could not be loaded.
              </LoadError>
            ) : importsReady && imports.data.length === 0 ? (
              <Text style={look.muted}>{REGISTER_IMPORT_COPY.EMPTY}</Text>
            ) : null}
            <View accessibilityLabel="Opening records">
              {(imports.data ?? []).map((proposal, index) => (
                <ImportRecord
                  key={proposal.uuid}
                  proposal={proposal}
                  guard={importGuard}
                  visible={importsReady}
                  ruled={index > 0}
                />
              ))}
            </View>
          </Section>
        </View>
      )}
    </>
  );
}
