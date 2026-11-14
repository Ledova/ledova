import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  FIELD_LIMITS,
  REGISTER_CORRECTION_COPY as COPY,
  appointmentForRegisterStep,
  describeEntry,
  entryInverse,
  useCorrectionEntry,
  useCorrectionPreparation,
  useErrorSummary,
  useOwnAppointments,
  useRegisterClasses,
  useSubmissionOwner,
  useUserPreferences,
  type CorrectionPreparationOptions,
  type OrderSubmissionOwner,
  type RegisterCorrectionAuthority,
} from '@ledova/shared';
import { Action, Fact, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { Choices, Field, FileField } from '../../components/Field';
import { useMemberRecordsState } from '../../contexts';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RegisterChanges } from './CorrectionRecord';
import { DATE, FormNote } from './IssueForms';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyRegisterCorrection.title;
const LEDE =
  "Prepare a correction that reverses one entry of a share class's register exactly. The authority document is " +
  'provided by the company.';

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];

export function CorrectionPreparationScreen({
  route,
}: {
  route: RouteProp<SignedInStackParamList, 'CorrectionPreparation'>;
}) {
  const { company, token, entry } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  const scope = useRetainedScope(
    owner,
    boundary.get,
    `${company}/${token}/${entry}`,
    !preferences.isError &&
      !preferences.isFetching &&
      readable &&
      !directory.hasError &&
      !directory.isLoading &&
      !directory.isRefreshing,
  );
  if (owner && scope.scope !== undefined)
    return (
      <OwnCorrection
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${scope.scope}`}
        owner={owner}
        currentOwner={scope.currentOwner}
        accountOwner={boundary.get}
        available={scope.available}
        company={company}
        token={token}
        entry={entry}
      />
    );
  return (
    <Page testID="correction-preparation-scroll" title={TITLE} lede={LEDE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnCorrection({
  owner,
  currentOwner,
  accountOwner,
  available,
  company,
  token,
  entry,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accountOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
  token: string;
  entry: string;
}) {
  const look = useLedgerStyles();
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
  const classes = useRegisterClasses(owner, accountGuard, orderSubmissionSession, available);
  const appointments = useOwnAppointments(owner, accountGuard, { session: orderSubmissionSession });
  const listed = classes.data?.find((item) => item.uuid === token);
  const companyMatches = listed?.companyUuid === company;
  const appointment =
    companyMatches && appointments.data ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const corrected = useCorrectionEntry(
    owner,
    token,
    entry,
    guard,
    available ? appointment : undefined,
    orderSubmissionSession,
  );
  const fetching = classes.isFetching || appointments.isFetching || corrected.isFetching;
  const stale = classes.isError || appointments.isError || corrected.isError;
  const fresh =
    available &&
    !fetching &&
    !stale &&
    classes.isSuccess &&
    appointments.isSuccess &&
    companyMatches &&
    !!appointment &&
    corrected.isSuccess &&
    !!corrected.data?.correctable;
  const [context, setContext] = useState<{
    listed: NonNullable<typeof listed>;
    appointment: NonNullable<typeof appointment>;
    entry: NonNullable<typeof corrected.data>;
  } | null>(null);
  if (
    fresh &&
    listed &&
    appointment &&
    corrected.data &&
    (!context ||
      (context.appointment.uuid === appointment.uuid &&
        (context.listed !== listed || context.entry !== corrected.data)))
  )
    setContext({ listed, appointment: context?.appointment ?? appointment, entry: corrected.data });
  const live = useRef({ ready: false, appointment: '' });
  useLayoutEffect(() => {
    live.current = {
      ready: fresh,
      appointment: appointment?.uuid ?? '',
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
  const formReady = fresh && appointment?.uuid === context?.appointment.uuid;
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (available && corrected.isError) void corrected.refetch();
  };
  const toCorrections = (params: SignedInStackParamList['Corrections']) => {
    Keyboard.dismiss();
    if (navigation.getState()?.routes.some(({ name }) => name === 'Corrections'))
      navigation.popTo('Corrections', params);
    else navigation.replace('Corrections', params);
  };
  let status: ReactNode;
  if (stale)
    status = (
      <LoadError retry={retry} busy={fetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    );
  else if (!classes.data || !appointments.data || fetching) status = <Loading>Loading the register…</Loading>;
  else if (!listed || !companyMatches)
    status = <Text style={look.muted}>This share class is not in a register you can read.</Text>;
  else if (!appointment) status = <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>;
  else if (corrected.data === undefined) status = <Loading>Loading the register…</Loading>;
  else if (corrected.data === null)
    status = <Text style={look.muted}>This entry is not in the register of this share class.</Text>;
  else if (!corrected.data.correctable)
    status = (
      <Text style={look.muted}>
        {corrected.data.correctedBy
          ? COPY.CORRECTED_NOTE
          : 'This entry records no change, so there is nothing to correct.'}
      </Text>
    );
  else if (context && appointment.uuid !== context.appointment.uuid)
    status = <Text style={look.muted}>Your preparation appointment changed. Reopen this form.</Text>;
  return (
    <Page
      testID="correction-preparation-scroll"
      title={TITLE}
      lede={LEDE}
      available={available}
      unavailable={<RegisterAccess owner={owner} />}
    >
      {!formReady && status}
      {context && (
        <View
          style={[look.fields, !formReady && look.hidden]}
          accessibilityElementsHidden={!formReady}
          importantForAccessibility={formReady ? 'auto' : 'no-hide-descendants'}
        >
          <Section title={context.listed.name}>
            <Text style={look.muted}>{context.listed.symbol}</Text>
            <Rows>
              <Fact label={COPY.ORIGINAL_CHANGES}>
                <RegisterChanges lead={describeEntry(context.entry)} changes={context.entry.changes} />
              </Fact>
              <Fact label={COPY.COMPENSATING_CHANGES}>
                <RegisterChanges changes={entryInverse(context.entry)} />
              </Fact>
            </Rows>
            <Text style={look.muted}>{COPY.COMPENSATION_NOTE}</Text>
          </Section>
          <Section title={COPY.PREPARE}>
            <CorrectionForm
              owner={owner}
              guard={formGuard}
              company={company}
              token={token}
              entry={context.entry}
              appointment={context.appointment}
              blocked={!formReady}
              onConflict={() => {
                void corrected.refetch();
                void appointments.refetch();
              }}
              onCancel={() => toCorrections({ company, token })}
              onPrepared={(record) => toCorrections({ company, token, record, outcome: COPY.PREPARED })}
            />
          </Section>
        </View>
      )}
    </Page>
  );
}

function CorrectionForm({
  onCancel,
  ...options
}: Omit<CorrectionPreparationOptions, 'newKey' | 'session'> & { onCancel: () => void }) {
  const look = useLedgerStyles();
  const model = useCorrectionPreparation({ ...options, newKey: randomUUID, session: orderSubmissionSession });
  const checks = useErrorSummary(model.problems);
  const { draft, busy, update } = model;
  return (
    <View style={look.fields}>
      <Choices
        legend={COPY.AUTHORITY}
        options={AUTHORITIES}
        value={draft.authority}
        disabled={busy}
        onChange={(authority) => update({ authority })}
      />
      {draft.authority === 'director_resolution' && (
        <Field
          label={COPY.APPROVING_DIRECTOR}
          value={draft.director}
          maxLength={FIELD_LIMITS.DIRECTOR}
          editable={!busy}
          error={checks.field('director').error}
          onChange={(director) => update({ director })}
        />
      )}
      <Field
        label={COPY.AUTHORITY_REFERENCE}
        value={draft.reference}
        maxLength={FIELD_LIMITS.REFERENCE}
        editable={!busy}
        error={checks.field('reference').error}
        onChange={(reference) => update({ reference })}
      />
      <Field
        label={COPY.EFFECTIVE_ON}
        hint={COPY.EFFECTIVE_ON_NOTE}
        value={draft.effectiveOn}
        editable={!busy}
        keyboardType={DATE.keyboardType}
        placeholder={DATE.placeholder}
        autoCapitalize={DATE.autoCapitalize}
        autoCorrect={DATE.autoCorrect}
        error={checks.field('effectiveOn').error}
        onChange={(effectiveOn) => update({ effectiveOn: effectiveOn.trim() })}
      />
      <FileField
        label={COPY.AUTHORITY_DOCUMENT}
        value={draft.file}
        hint={COPY.AUTHORITY_DOCUMENT_NOTE}
        disabled={busy}
        error={checks.field('file').error}
        onFile={(file) => update({ file })}
      />
      <Field
        label={COPY.REASON}
        value={draft.reason}
        maxLength={FIELD_LIMITS.REASON}
        multiline
        rows={3}
        editable={!busy}
        error={checks.field('reason').error}
        onChange={(reason) => update({ reason })}
      />
      <FormNote error={model.error} />
      <FormActions>
        <Action label="Cancel" accessibilityLabel="Cancel (correction)" disabled={busy} onPress={onCancel} />
        <Action
          primary
          label={busy ? 'Preparing correction…' : COPY.SUBMIT}
          disabled={options.blocked}
          onPress={() => {
            if (busy || options.blocked || !checks.check()) return;
            Keyboard.dismiss();
            void model.submit();
          }}
        />
      </FormActions>
    </View>
  );
}
