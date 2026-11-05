import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_AWARD_COPY as COPY,
  allPeopleKey,
  appointmentForRegisterStep,
  awardsKey,
  formatDate,
  awardSummary,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  peopleFrom,
  registerKey,
  useOwnAppointments,
  usePeople,
  useRegisterAwards,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Actions, LinkRow, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import { RegisterAccess } from '../../components/RegisterAccess';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AwardForm } from './AwardForms';
import { useShareholderStyles } from './useShareholderStyles';

const TITLE = DESTINATIONS.companyRegister.views.awards;
const LEDE = 'Record employee entitlements and vesting. Shares are issued through a separate company decision.';

export function EmployeeSchemeScreen() {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company, companySelection } = useMemberRecordsState();
  const preferences = useUserPreferences();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  const scope = useRetainedScope(
    owner,
    boundary.get,
    company?.uuid,
    !preferences.isError &&
      !preferences.isFetching &&
      !!company?.canReadRegister &&
      !directory.hasError &&
      !choosing &&
      !directory.isRefreshing,
    companySelection,
  );
  if (owner && scope.scope)
    return (
      <CompanyScheme
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${scope.scope}`}
        owner={owner}
        currentOwner={boundary.get}
        company={scope.scope}
        available={scope.available}
      />
    );
  return (
    <Page testID="employee-scheme-scroll" title={TITLE} lede={LEDE}>
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

function CompanyScheme({
  owner,
  currentOwner,
  available,
  company,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
}) {
  const theme = useAppTheme();
  const source = useCompanyRegisters(owner, currentOwner, company, TITLE, available);
  const [chosen, setChosen] = useState('');
  const [editing, setEditing] = useState(false);
  const [held, setHeld] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshAwards = useRef<() => Promise<unknown>>(async () => undefined);
  const registers = source.registers ?? [];
  const register = registers.find(({ token }) => token.uuid === chosen) ?? registers[0];
  return (
    <Page
      testID="employee-scheme-scroll"
      title={TITLE}
      lede={LEDE}
      available={available && source.sourceReady}
      unavailable={
        !available ? (
          <RegisterAccess owner={owner} />
        ) : source.accountError ? (
          <LoadError retry={source.retryAccount} busy={source.isRefreshing}>
            Your account could not be loaded.
          </LoadError>
        ) : source.hasError || source.invalid ? (
          <LoadError retry={source.retry} busy={source.isRefreshing}>
            The register could not be loaded.
          </LoadError>
        ) : (
          <Loading>Loading the register…</Loading>
        )
      }
      titleAction={
        available && source.sourceReady && registers.length > 1 && register ? (
          <FilterPopover>
            {(close) => (
              <SelectField
                label="Share class"
                options={registers.map(({ token }) => ({
                  value: token.uuid,
                  label: `${token.name} · ${token.symbol}`,
                }))}
                value={register.token.uuid}
                disabled={editing || held}
                onChange={(token) => {
                  if (editing || held) return;
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
          testID="employee-scheme-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (!available || refreshing || editing || held) return;
            setRefreshing(true);
            void Promise.all([source.retry(), refreshAwards.current()]).finally(() => setRefreshing(false));
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
      ) : !source.sourceReady && !register ? (
        <Loading>Loading the register…</Loading>
      ) : null}
      {register && (
        <ClassAwards
          key={`${company}/${register.token.uuid}`}
          owner={owner}
          company={company}
          register={register}
          guard={source.guard}
          accountGuard={source.accountGuard}
          sourceReady={source.sourceReady}
          refreshRef={refreshAwards}
          onEditingChange={setEditing}
          onHeldChange={setHeld}
        />
      )}
    </Page>
  );
}

function ClassAwards({
  owner,
  company,
  register,
  guard,
  accountGuard,
  sourceReady,
  refreshRef,
  onEditingChange,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  accountGuard: () => void;
  sourceReady: boolean;
  refreshRef: RefObject<() => Promise<unknown>>;
  onEditingChange: (editing: boolean) => void;
  onHeldChange: (held: boolean) => void;
}) {
  const client = useQueryClient();
  const look = useShareholderStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const live = useRef(true);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const appointments = useOwnAppointments(owner, accountGuard, { session: orderSubmissionSession });
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], company);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = useMemo(
    () => () => {
      guard();
      if (!live.current) throw new Error('This award section is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company],
  );
  const token = register.token.uuid;
  const awards = useRegisterAwards(owner, company, token, check, readable && sourceReady, orderSubmissionSession);
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const supported = register.initialized && register.token.status === 'draft';
  const members = usePeople(
    owner,
    token,
    check,
    sourceReady && editing && !!appointment && supported,
    orderSubmissionSession,
  );
  const blocked =
    !readable || !sourceReady || awards.isFetching || awards.isError || appointments.isFetching || appointments.isError;
  const visible =
    readable &&
    sourceReady &&
    !awards.isFetching &&
    !awards.isError &&
    !appointments.isFetching &&
    !appointments.isError;
  useEffect(() => {
    onEditingChange(editing);
  }, [onEditingChange, editing]);
  useEffect(() => {
    onHeldChange(formHeld);
  }, [onHeldChange, formHeld]);
  useEffect(
    () => () => {
      onEditingChange(false);
      onHeldChange(false);
    },
    [onEditingChange, onHeldChange],
  );
  const refresh = async (throwOnError = false) => {
    await appointments.refetch({ cancelRefetch: false, throwOnError });
    guard();
    const current = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    latestAppointments.current = current?.status === 'success' ? (current.data ?? []) : [];
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(current.data ?? [], company)
    )
      return;
    await awards.refetch({ cancelRefetch: false, throwOnError });
    check();
    await Promise.all([
      client.invalidateQueries({
        queryKey: awardsKey(owner, token),
        predicate: ({ queryKey }) => queryKey.length > awardsKey(owner, token).length,
      }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'invitation-awards', company] }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'member-awards', company] }),
    ]);
  };
  useLayoutEffect(() => {
    refreshRef.current = () => refresh().catch(() => undefined);
  });
  const status = (
    <>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {appointments.isSuccess && readable && !appointment && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {appointments.isError ? null : !appointments.isSuccess ||
        (readable && (awards.isPending || awards.isFetching || appointments.isFetching)) ? (
        <Loading>Loading employee awards…</Loading>
      ) : !readable ? (
        <Text style={look.muted}>A current company register appointment is required to read employee awards.</Text>
      ) : null}
      {awards.isError && (
        <LoadError retry={() => refresh()} busy={awards.isFetching || appointments.isFetching}>
          Employee awards could not be loaded.
        </LoadError>
      )}
    </>
  );
  const className = `${register.token.name} · ${register.token.symbol}`;
  return (
    <>
      <Section title={editing ? COPY.PREPARE : sourceReady && readable ? className : COPY.TITLE}>
        {editing && sourceReady && readable && <Text style={look.muted}>{className}</Text>}
        {status}
        {!editing && visible && awards.data?.length === 0 && <Text style={look.muted}>{COPY.EMPTY}</Text>}
        {!editing && visible && !!awards.data?.length && (
          <View accessibilityLabel="Employee awards">
            <Rows>
              {awards.data.map((award) => (
                <LinkRow
                  key={award.uuid}
                  label={award.recipientName}
                  accessibilityLabel={`${award.recipientName} (employee award, agreement ${formatDate(award.termsOn)})`}
                  figure={awardSummary(award).figure}
                  onPress={() => navigation.navigate('EmployeeAward', { company, token, award: award.uuid })}
                >
                  <Text style={look.small}>{awardSummary(award).facts}</Text>
                </LinkRow>
              ))}
            </Rows>
          </View>
        )}
        {editing && members.isPending && <Loading>Loading retained recipients…</Loading>}
        {editing && members.isError && (
          <LoadError retry={() => members.refetch()} busy={members.isFetching}>
            The retained recipients could not be loaded.
          </LoadError>
        )}
        {editing && formAppointment && (
          <AwardForm
            key={`${company}/${token}/${formAppointment.uuid}`}
            company={company}
            token={token}
            people={peopleFrom(members.data)}
            appointment={formAppointment}
            guard={check}
            blocked={blocked || (!formHeld && (members.isPending || members.isFetching || members.isError))}
            visible={visible && (formHeld || (members.isSuccess && !members.isFetching))}
            canPrepare={
              supported &&
              !!appointmentForRegisterStep(
                appointments.isSuccess ? appointments.data.filter((item) => item.uuid === formAppointment.uuid) : [],
                company,
                'prepare',
              )
            }
            onCancel={() => {
              setEditing(false);
              setFormAppointment(null);
            }}
            onHeldChange={setFormHeld}
            onRecorded={async () => {
              check();
              await refresh(true);
              check();
              setFormHeld(false);
              setEditing(false);
              setFormAppointment(null);
            }}
          />
        )}
      </Section>
      {!editing && appointment && supported && (
        <Actions>
          <Action
            primary
            label={COPY.PREPARE}
            disabled={blocked || formHeld}
            onPress={() => {
              setFormAppointment(appointment);
              setEditing(true);
            }}
          />
        </Actions>
      )}
    </>
  );
}
