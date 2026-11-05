import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  FIELD_LIMITS,
  REGISTER_PARTICULARS_COPY as COPY,
  useErrorSummary,
  useParticularsEdit,
  useParticularsMember,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Action, Fact, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { Field } from '../../components/register/RegisterFields';
import { useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useShareholderStyles } from './useShareholderStyles';

const TITLE = DESTINATIONS.companyRegisterParticulars.title;
const LEDE = "The change is recorded at once and kept in the register's history.";

export function ParticularsScreen({ route }: { route: RouteProp<SignedInStackParamList, 'ShareholderParticulars'> }) {
  const { company, member } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  const scope = useRetainedScope(
    owner,
    boundary.get,
    `${company}/${member}`,
    !preferences.isError &&
      !preferences.isFetching &&
      readable &&
      !directory.hasError &&
      !directory.isLoading &&
      !directory.isRefreshing,
  );
  if (owner && scope.scope !== undefined)
    return (
      <OwnParticulars
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${scope.scope}`}
        owner={owner}
        currentOwner={scope.currentOwner}
        accountOwner={boundary.get}
        available={scope.available}
        company={company}
        member={member}
      />
    );
  return (
    <Page testID="particulars-scroll" title={TITLE} lede={LEDE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnParticulars({
  owner,
  currentOwner,
  accountOwner,
  available,
  company,
  member,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accountOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
  member: string;
}) {
  const look = useShareholderStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
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
  const { classes, appointments, editing, registers, people, found } = useParticularsMember(
    owner,
    guard,
    member,
    orderSubmissionSession,
    { available, accountGuard },
  );
  const reads = [...registers, ...people];
  const fetching = classes.isFetching || appointments.isFetching || reads.some((read) => read.isFetching);
  const stale =
    classes.isError ||
    appointments.isError ||
    (found ? found.read.isError || found.particulars.isError : reads.some((read) => read.isError));
  const recorded = found?.particulars.data?.members.find((row) => row.member === member);
  const fresh =
    available &&
    !fetching &&
    !stale &&
    classes.isSuccess &&
    appointments.isSuccess &&
    found?.company.uuid === company &&
    found.particulars.isSuccess &&
    found.particulars.isFetchedAfterMount &&
    found.particulars.fetchStatus === 'idle';
  const [context, setContext] = useState<{
    appointment: NonNullable<typeof found>['company']['appointment'];
    name: string | null;
    label: string;
    particulars: NonNullable<typeof found>['particulars']['data'];
  } | null>(null);
  if (
    fresh &&
    found &&
    !recorded?.followsProfile &&
    (!context ||
      (context.appointment.uuid === found.company.appointment.uuid &&
        (context.name !== found.name ||
          context.label !== found.label ||
          context.particulars !== found.particulars.data)))
  )
    setContext({
      appointment: context?.appointment ?? found.company.appointment,
      name: found.name,
      label: found.label,
      particulars: found.particulars.data,
    });
  const live = useRef({ ready: false, appointment: '' });
  useLayoutEffect(() => {
    live.current = {
      ready:
        available &&
        classes.isSuccess &&
        !classes.isFetching &&
        appointments.isSuccess &&
        !appointments.isFetching &&
        found?.company.uuid === company &&
        !stale &&
        !recorded?.followsProfile,
      appointment: found?.company.uuid === company ? found.company.appointment.uuid : '',
    };
  });
  const expectedAppointment = context?.appointment.uuid;
  const formGuard = useMemo(
    () => () => {
      guard();
      if (!live.current.ready || live.current.appointment !== expectedAppointment)
        throw new Error('Your preparation appointment changed. Reopen this form.');
    },
    [guard, expectedAppointment],
  );
  const formReady = fresh && !recorded?.followsProfile && found?.company.appointment.uuid === context?.appointment.uuid;
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (available) for (const read of reads) if (read.isError) void read.refetch();
  };
  let status: ReactNode;
  if (stale)
    status = (
      <LoadError retry={retry} busy={fetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    );
  else if (!classes.data || !appointments.data || fetching) status = <Loading>Loading the register…</Loading>;
  else if (found && found.company.uuid !== company)
    status = <Text style={look.muted}>This share class is not in a register you can read.</Text>;
  else if (editing.length === 0) status = <Text style={look.muted}>{COPY.AUTHORITY_NOTE}</Text>;
  else if (!found)
    status = reads.some((read) => read.isPending) ? (
      <Loading>Loading the register…</Loading>
    ) : (
      <Text style={look.muted}>This member is not a current member of a register you can change.</Text>
    );
  else if (found.particulars.isPending || !found.particulars.isFetchedAfterMount)
    status = <Loading>Loading their particulars…</Loading>;
  else if (recorded?.followsProfile)
    status = (
      <Section title="Current particulars">
        <Rows>
          <Fact label="Name">{recorded.name || found.name || 'Not recorded'}</Fact>
          <Fact label="Residential address">{recorded.residentialAddress || 'Not recorded'}</Fact>
        </Rows>
        <Text style={look.muted}>{COPY.FOLLOWS_PROFILE}</Text>
      </Section>
    );
  else if (context && found.company.appointment.uuid !== context.appointment.uuid)
    status = <Text style={look.muted}>Your preparation appointment changed. Reopen this form.</Text>;
  const previous = context?.particulars?.members.find((row) => row.member === member);
  return (
    <Page
      testID="particulars-scroll"
      title={fresh && found?.company.uuid === company ? found.label : TITLE}
      lede={LEDE}
      available={available}
      unavailable={<RegisterAccess owner={owner} />}
    >
      {!formReady && status}
      {context && (
        <View
          style={!formReady && { display: 'none' }}
          accessibilityElementsHidden={!formReady}
          importantForAccessibility={formReady ? 'auto' : 'no-hide-descendants'}
        >
          <Section title={COPY.PREPARE}>
            <ParticularsForm
              owner={owner}
              guard={formGuard}
              company={company}
              member={member}
              appointment={context.appointment}
              current={{ name: previous?.name || context.name || '', address: previous?.residentialAddress ?? '' }}
              recorded={{ name: previous?.name ?? '', address: previous?.residentialAddress ?? '' }}
              blocked={!formReady}
              onConflict={() => {
                if (found) {
                  void found.read.refetch();
                  void found.particulars.refetch();
                }
                void appointments.refetch();
              }}
              onMissing={() => void appointments.refetch()}
              onChanged={() => {
                Keyboard.dismiss();
                navigation.popTo('Shareholder', { company, member, outcome: 'Particulars changed.' });
              }}
            />
          </Section>
        </View>
      )}
    </Page>
  );
}

function ParticularsForm(props: Omit<Parameters<typeof useParticularsEdit>[0], 'newKey' | 'session'>) {
  const styles = useCompanyStyles();
  const look = useShareholderStyles();
  const { draft, busy, error, conflict, update, reload, problems, submit } = useParticularsEdit({
    ...props,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const checks = useErrorSummary(problems);
  const blocked = useRef(props.blocked);
  useLayoutEffect(() => {
    blocked.current = props.blocked;
  }, [props.blocked]);
  return (
    <View style={look.form}>
      <Field
        label={COPY.NAME}
        value={draft.name}
        maxLength={FIELD_LIMITS.NAME}
        editable={!busy}
        error={checks.field('name').error}
        onChange={(name) => update({ name })}
      />
      <Field
        label={COPY.RESIDENTIAL_ADDRESS}
        value={draft.address}
        maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
        multiline
        rows={3}
        editable={!busy}
        error={checks.field('address').error}
        onChange={(address) => update({ address })}
      />
      <Field
        label={`${COPY.REASON} (optional)`}
        value={draft.reason}
        maxLength={FIELD_LIMITS.REASON}
        multiline
        rows={3}
        editable={!busy}
        onChange={(reason) => update({ reason })}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <FormActions>
        {conflict && <Action label={COPY.RELOAD} onPress={reload} />}
        <Action
          primary
          label={busy ? 'Saving change…' : COPY.SUBMIT}
          disabled={busy || props.blocked || conflict}
          onPress={() => {
            if (blocked.current || !checks.check()) return;
            Keyboard.dismiss();
            void submit();
          }}
        />
      </FormActions>
    </View>
  );
}
