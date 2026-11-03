import { useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  FIELD_LIMITS,
  REGISTER_TRANSFER_COPY as COPY,
  appointmentForRegisterStep,
  formatDate,
  peopleFrom,
  shareCount,
  useErrorSummary,
  useOwnAppointments,
  usePeople,
  useRegisterClasses,
  useRegisters,
  useSubmissionOwner,
  useTransferPreparation,
  useUserPreferences,
  type OrderSubmissionOwner,
  type Person,
  type TransferDocumentKind,
  type TransferPreparationOptions,
} from '@ledova/shared';
import { Action, Fact, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { PersonSelect } from '../../components/PersonSelect';
import { RegisterAccess } from '../../components/RegisterAccess';
import { Field, FileField } from '../../components/register/RegisterFields';
import { useMemberRecordsState } from '../../contexts';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { DATE, FormNote, FormSteps } from './IssueForms';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyRegister.tasks.transfer;

const STEPS = [
  {
    id: 'people',
    label: 'People and shares',
    fields: ['fromMember', 'toMember', 'name', 'residentialAddress', 'shares', 'companyEventOn'],
  },
  {
    id: 'documents',
    label: 'Transfer documents',
    fields: ['signedOn', 'lodgedOn', 'terms', 'instrumentDocument'],
  },
  {
    id: 'review',
    label: 'Company authority and review',
    fields: ['approvingDirector', 'authorityReference', 'reason', 'authorityDocument'],
  },
] as const;

type Draft = ReturnType<typeof useTransferPreparation>['draft'];
type FieldKey = Exclude<keyof Draft, 'fromMember' | 'toMember' | 'name' | 'residentialAddress'>;

const LIMITS: Partial<Record<FieldKey, number>> = {
  shares: FIELD_LIMITS.REGISTER_SHARES,
  terms: FIELD_LIMITS.TERMS,
  approvingDirector: FIELD_LIMITS.DIRECTOR,
  authorityReference: FIELD_LIMITS.REFERENCE,
  reason: FIELD_LIMITS.REASON,
};

function inClass(person: Person) {
  return person.onRegister === false ? '' : `${shareCount(person.currentShares)} in this class`;
}

export function TransferPreparationScreen({
  route,
}: {
  route: RouteProp<SignedInStackParamList, 'TransferPreparation'>;
}) {
  const { company, token, fromMember } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  if (owner && !preferences.isError && readable && !directory.hasError && !directory.isLoading)
    return (
      <OwnTransfer
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${token}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company}
        token={token}
        fromMember={fromMember ?? ''}
      />
    );
  return (
    <Page testID="transfer-preparation-scroll" title={TITLE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnTransfer({
  owner,
  currentOwner,
  company,
  token,
  fromMember,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  token: string;
  fromMember: string;
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
  const registers = useRegisters(owner, companyMatches ? [token] : [], guard, orderSubmissionSession);
  const register = registers.data?.[0];
  const members = usePeople(owner, token, guard, !!appointment, orderSubmissionSession);
  const busy = classes.isFetching || appointments.isFetching || registers.isFetching || members.isFetching;
  const stale = classes.isError || appointments.isError || registers.isError || members.isError;
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    if (companyMatches) void registers.refetch();
    if (appointment) void members.refetch();
  };
  const toTransfers = (params: SignedInStackParamList['TransferShares']) => {
    Keyboard.dismiss();
    if (navigation.getState()?.routes.some(({ name }) => name === 'TransferShares'))
      navigation.popTo('TransferShares', params);
    else navigation.replace('TransferShares', params);
  };
  const failure = (
    <LoadError retry={retry} busy={busy}>
      The register or your appointments could not be loaded.
    </LoadError>
  );
  let content: ReactNode;
  if (!classes.data || !appointments.data) content = stale ? failure : <Loading>Loading the register…</Loading>;
  else if (!listed || !companyMatches)
    content = <Text style={look.muted}>This share class is not in a register you can read.</Text>;
  else if (!appointment) content = <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>;
  else if (!register || !members.data) content = stale ? failure : <Loading>Loading the register…</Loading>;
  else if (!register.initialized || register.token.status !== 'draft')
    content = (
      <Text style={look.muted}>
        This transfer requires an opened register for a draft share class without a deployed contract.
      </Text>
    );
  else
    content = (
      <Section title="Non-paid transfer">
        {stale && failure}
        <TransferForm
          owner={owner}
          guard={guard}
          company={company}
          token={token}
          classLabel={`${listed.name} (${listed.symbol})`}
          people={peopleFrom(members.data)}
          appointment={appointment}
          blocked={stale || busy}
          onRefused={retry}
          initialFrom={fromMember}
          onCancel={() => toTransfers({ company, token })}
          onPrepared={(record) => toTransfers({ company, token, record, outcome: COPY.PREPARED })}
        />
      </Section>
    );
  return (
    <Page
      testID="transfer-preparation-scroll"
      title={TITLE}
      lede={companyMatches && listed && appointment ? `${listed.name} (${listed.symbol})` : undefined}
    >
      {content}
    </Page>
  );
}

function TransferForm({
  classLabel,
  onCancel,
  ...options
}: Omit<TransferPreparationOptions, 'newKey' | 'session'> & { classLabel: string; onCancel: () => void }) {
  const look = useLedgerStyles();
  const { blocked } = options;
  const model = useTransferPreparation({ ...options, newKey: randomUUID, session: orderSubmissionSession });
  const checks = useErrorSummary(model.problems);
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('people');
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const locked = model.busy || blocked || !!model.operation;
  const field = (key: FieldKey, label: string, accessibilityLabel?: string) => {
    const date = key.endsWith('On');
    return (
      <Field
        label={label}
        accessibilityLabel={accessibilityLabel}
        value={model.draft[key]}
        editable={!locked}
        maxLength={LIMITS[key]}
        keyboardType={date ? DATE.keyboardType : key === 'shares' ? 'number-pad' : undefined}
        placeholder={date ? DATE.placeholder : undefined}
        autoCapitalize={date ? DATE.autoCapitalize : undefined}
        autoCorrect={date ? DATE.autoCorrect : undefined}
        multiline={key === 'terms'}
        rows={3}
        error={checks.field(key).error}
        onChange={(value) => model.change(key, date || key === 'shares' ? value.trim() : value)}
      />
    );
  };
  const document = (kind: TransferDocumentKind, accessibilityLabel: string) => (
    <FileField
      label="Document"
      accessibilityLabel={accessibilityLabel}
      disabled={locked}
      error={checks.field(`${kind}Document`).error}
      onFile={(file) => {
        model.setOperation(null);
        model.setFiles((current) => ({ ...current, [kind]: file ?? undefined }));
      }}
    />
  );
  const submit = () => {
    if (model.busy || blocked) return;
    if (model.operation) {
      Keyboard.dismiss();
      void model.submit();
      return;
    }
    if (step !== 'review') {
      if (!checks.check(STEPS[stepIndex].fields)) return;
      Keyboard.dismiss();
      setStep(STEPS[stepIndex + 1].id);
      return;
    }
    const invalid = STEPS.find((item) => item.fields.some((key) => model.problems[key]));
    if (invalid) {
      setStep(invalid.id);
      checks.check(invalid.fields);
    } else if (checks.check()) {
      Keyboard.dismiss();
      void model.submit();
    }
  };
  return (
    <View style={look.form}>
      <FormSteps label="Transfer steps" steps={STEPS} current={step} />
      <View style={[look.fields, step !== 'people' && look.hidden]}>
        <Text accessibilityRole="header" style={look.heading}>
          People and shares
        </Text>
        <PersonSelect
          label={COPY.FROM}
          people={model.eligible.filter((member) => member.particularsRetained && BigInt(member.currentShares) > 0n)}
          value={model.draft.fromMember}
          onChange={(value) => model.change('fromMember', value)}
          context={inClass}
          disabled={locked}
          error={checks.field('fromMember').error}
        />
        <PersonSelect
          label={COPY.TO}
          people={model.eligible.filter((member) => member.member !== model.draft.fromMember)}
          value={model.draft.toMember}
          onChange={(value) => model.change('toMember', value)}
          context={inClass}
          disabled={locked}
          error={checks.field('toMember').error}
        />
        {model.fresh && (
          <>
            <Field
              label="Name"
              value={model.draft.name}
              maxLength={FIELD_LIMITS.NAME}
              editable={!locked}
              error={checks.field('name').error}
              onChange={(value) => model.change('name', value)}
            />
            <Field
              label="Residential address"
              value={model.draft.residentialAddress}
              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
              multiline
              editable={!locked}
              error={checks.field('residentialAddress').error}
              onChange={(value) => model.change('residentialAddress', value)}
            />
          </>
        )}
        {!!model.recipient?.lastCeasedOn && (
          <Text style={look.muted}>
            Last ceased in this class: {formatDate(model.recipient.lastCeasedOn)}. The same member ID is retained on
            return.
          </Text>
        )}
        {model.fresh && (
          <Text style={look.muted}>
            This member’s particulars passed the retention period. Supply their current particulars from the signed
            instrument, keeping their existing member ID.
          </Text>
        )}
        {field('shares', COPY.SHARES)}
        {field('companyEventOn', COPY.COMPANY_EVENT_ON)}
      </View>
      <View style={[look.fields, step !== 'documents' && look.hidden]}>
        <Text accessibilityRole="header" style={look.heading}>
          Transfer documents
        </Text>
        {field('signedOn', 'Signed on')}
        {field('lodgedOn', 'Lodged with company on')}
        {field('terms', 'Terms', 'Transfer terms')}
        {document('instrument', 'Signed transfer instrument')}
      </View>
      <View style={[look.fields, step !== 'review' && look.hidden]}>
        <Text accessibilityRole="header" style={look.heading}>
          Transfer summary
        </Text>
        <Rows>
          <Fact label={COPY.FROM}>{model.from?.name ?? ''}</Fact>
          <Fact label={COPY.TO}>{(model.fresh ? model.draft.name : model.recipient?.name) ?? ''}</Fact>
          <Fact label="Share class">{classLabel}</Fact>
          <Fact label="Shares">{shareCount(model.draft.shares)}</Fact>
          <Fact label="Transfer date">{formatDate(model.draft.companyEventOn)}</Fact>
          <Fact label="Signed transfer instrument">{model.files.instrument?.name ?? ''}</Fact>
        </Rows>
        <View style={[look.fields, look.ruled]}>
          <Text accessibilityRole="header" style={look.heading}>
            Company authority
          </Text>
          {field('approvingDirector', COPY.DIRECTOR)}
          {field('authorityReference', 'Authority reference')}
          {field('reason', 'Reason')}
          {document('authority', 'Authority document')}
        </View>
      </View>
      <FormNote
        error={model.error}
        note={
          model.operation
            ? 'The preparation could not be confirmed. Retry to retrieve the original transfer with these details and documents.'
            : undefined
        }
      />
      <FormActions>
        {stepIndex > 0 && (
          <Action
            label="Back"
            disabled={locked}
            onPress={() => {
              checks.reset();
              Keyboard.dismiss();
              setStep(STEPS[stepIndex - 1].id);
            }}
          />
        )}
        <Action label="Cancel" accessibilityLabel="Cancel (non-paid transfer)" disabled={locked} onPress={onCancel} />
        <Action
          primary
          label={model.busy ? 'Preparing transfer…' : step === 'review' ? COPY.SUBMIT : 'Continue'}
          disabled={blocked}
          onPress={submit}
        />
      </FormActions>
    </View>
  );
}
