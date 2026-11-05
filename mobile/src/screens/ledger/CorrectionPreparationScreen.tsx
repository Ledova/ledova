import { useMemo, type ReactNode } from 'react';
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
import { Choices, Field, FileField } from '../../components/register/RegisterFields';
import { useMemberRecordsState } from '../../contexts';
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
  if (owner && !preferences.isError && readable && !directory.hasError && !directory.isLoading)
    return (
      <OwnCorrection
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${token}/${entry}`}
        owner={owner}
        currentOwner={boundary.get}
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
  company,
  token,
  entry,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
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
  const classes = useRegisterClasses(owner, guard, orderSubmissionSession);
  const appointments = useOwnAppointments(owner, guard, { session: orderSubmissionSession });
  const listed = classes.data?.find((item) => item.uuid === token);
  const companyMatches = listed?.companyUuid === company;
  const appointment =
    companyMatches && appointments.data ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const corrected = useCorrectionEntry(owner, token, entry, guard, appointment, orderSubmissionSession);
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (corrected.isError) void corrected.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || corrected.isFetching;
  const stale = classes.isError || appointments.isError || corrected.isError;
  const toCorrections = (params: SignedInStackParamList['Corrections']) => {
    Keyboard.dismiss();
    if (navigation.getState()?.routes.some(({ name }) => name === 'Corrections'))
      navigation.popTo('Corrections', params);
    else navigation.replace('Corrections', params);
  };
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content =
      classes.isError || appointments.isError ? (
        <LoadError retry={retry} busy={fetching}>
          {classes.isError ? 'The register could not be loaded.' : 'Your appointments could not be loaded.'}
        </LoadError>
      ) : (
        <Loading>Loading the register…</Loading>
      );
  else if (!listed || !companyMatches)
    content = <Text style={look.muted}>This share class is not in a register you can read.</Text>;
  else if (!appointment) content = <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>;
  else if (corrected.data === undefined)
    content = corrected.isError ? (
      <LoadError retry={retry} busy={fetching}>
        The register could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
  else if (corrected.data === null)
    content = <Text style={look.muted}>This entry is not in the register of this share class.</Text>;
  else if (!corrected.data.correctable)
    content = (
      <Text style={look.muted}>
        {corrected.data.correctedBy
          ? COPY.CORRECTED_NOTE
          : 'This entry records no change, so there is nothing to correct.'}
      </Text>
    );
  else {
    content = (
      <>
        <Section title={listed.name}>
          <Text style={look.muted}>{listed.symbol}</Text>
          <Rows>
            <Fact label={COPY.ORIGINAL_CHANGES}>
              <RegisterChanges lead={describeEntry(corrected.data)} changes={corrected.data.changes} />
            </Fact>
            <Fact label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={entryInverse(corrected.data)} />
            </Fact>
          </Rows>
          <Text style={look.muted}>{COPY.COMPENSATION_NOTE}</Text>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && (
            <LoadError retry={retry} busy={fetching}>
              The register or your appointments could not be loaded.
            </LoadError>
          )}
          <CorrectionForm
            owner={owner}
            guard={guard}
            company={company}
            token={token}
            entry={corrected.data}
            appointment={appointment}
            blocked={stale}
            onConflict={() => {
              void corrected.refetch();
              void appointments.refetch();
            }}
            onCancel={() => toCorrections({ company, token })}
            onPrepared={(record) => toCorrections({ company, token, record, outcome: COPY.PREPARED })}
          />
        </Section>
      </>
    );
  }
  return (
    <Page testID="correction-preparation-scroll" title={TITLE} lede={LEDE}>
      {content}
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
