import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  AUTH_QUERY_KEY,
  DESTINATIONS,
  FIELD_LIMITS,
  REGISTER_CLASS_TYPES,
  REGISTER_COPY,
  REGISTER_IMPORT_COPY as COPY,
  REGISTER_SETUP_CHOICES,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  canOpenEmptyRegister,
  createUserFriendlyError,
  formatShareCount,
  importRegisterKey,
  importsKey,
  ownAppointmentsKey,
  peopleKey,
  registerClassesKey,
  registerSteps,
  useImportRegister,
  useNewShareClass,
  useOwnAppointments,
  usePeople,
  useRegisterClasses,
  useRegisterImports,
  useStartedClasses,
  useSubmissionOwner,
  useUserPreferences,
  type Company,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterImport,
  type RegisterSteps,
  type RegisterTransferMember,
  type RegisterTransferMembers,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Fact, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { Choices, Field } from '../../components/register/RegisterFields';
import { useMemberRecordsState, useThemedStyles } from '../../contexts';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import { ImportForm } from './ImportForm';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyRegisterSetup.title;
const NO_MEMBERS: RegisterTransferMembers = { members: [], awardRecipients: [] };

type Opener = 'Ledger' | 'IssueShares' | 'TransferShares' | 'Corrections';

type Flow = {
  onCancel: () => void;
  onOpen: (place: Opener) => void;
  onPrepared: (token: string, record: string) => void;
  onFinished: () => void;
};

function ownerGuard(owner: OrderSubmissionOwner, currentOwner: () => OrderSubmissionOwner | null) {
  return () => {
    if (currentOwner() !== owner) throw createUserFriendlyError('Your signed-in account changed. Reopen the register.');
  };
}

function useLinkStyle() {
  return useThemedStyles((theme) => ({
    link: { color: theme.colors.brand.light, textDecorationLine: 'underline' as const },
  })).link;
}

function Cancel({ onCancel }: { onCancel: () => void }) {
  return (
    <FormActions>
      <Action label="Cancel" accessibilityLabel="Cancel (ledger setup)" onPress={onCancel} />
    </FormActions>
  );
}

export function RegisterSetupScreen({ route }: { route: RouteProp<SignedInStackParamList, 'RegisterSetup'> }) {
  const { company, token, record, from } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  const access = useRetainedScope(
    owner,
    boundary.get,
    `${company}/${token ?? 'new'}/${record ?? ''}`,
    !preferences.isError &&
      !preferences.isFetching &&
      readable &&
      !directory.hasError &&
      !directory.isLoading &&
      !directory.isRefreshing,
  );
  const open = (place: Opener) => {
    Keyboard.dismiss();
    const listed = !!navigation.getState()?.routes.some(({ name }) => name === place);
    const params = { company, token: token ?? '' };
    if (place === 'Ledger') {
      if (listed) navigation.popTo(place);
      else navigation.replace(place);
    } else if (place === 'IssueShares') {
      if (listed) navigation.popTo(place, params);
      else navigation.replace(place, params);
    } else if (place === 'TransferShares') {
      if (listed) navigation.popTo(place, params);
      else navigation.replace(place, params);
    } else if (listed) navigation.popTo(place, params);
    else navigation.replace(place, params);
  };
  const flow: Flow = {
    onCancel: () => open(from ?? 'Ledger'),
    onOpen: open,
    onPrepared: (prepared, saved) => navigation.setParams({ token: prepared, record: saved }),
    onFinished: () => navigation.popTo('Dashboard'),
  };
  if (owner && access.scope !== undefined) {
    const scope = `${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}`;
    return token ? (
      <OwnImport
        key={`${scope}/${token}/${record ?? ''}`}
        owner={owner}
        currentOwner={access.currentOwner}
        accountOwner={boundary.get}
        available={access.available}
        company={company}
        token={token}
        record={record}
        {...flow}
      />
    ) : (
      <NewClassSetup
        key={scope}
        owner={owner}
        currentOwner={access.currentOwner}
        accountOwner={boundary.get}
        available={access.available}
        company={company}
        onContinue={(started) => navigation.setParams({ token: started, record: undefined })}
        {...flow}
      />
    );
  }
  return (
    <Page testID="register-setup-scroll" title={TITLE}>
      <RegisterAccess owner={owner} />
      <Cancel onCancel={flow.onCancel} />
    </Page>
  );
}

function NewClassSetup({
  owner,
  currentOwner,
  accountOwner,
  available,
  company,
  onContinue,
  ...flow
}: Flow & {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accountOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
  onContinue: (token: string) => void;
}) {
  const look = useLedgerStyles();
  const client = useQueryClient();
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<{ company: Pick<Company, 'uuid' | 'name'>; steps: RegisterSteps } | null>(
    null,
  );
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const accountGuard = useMemo(() => ownerGuard(owner, accountOwner), [owner, accountOwner]);
  const appointments = useOwnAppointments(owner, accountGuard, { session: orderSubmissionSession });
  const classes = useRegisterClasses(owner, accountGuard, orderSubmissionSession, available);
  const chosen = (appointments.data ?? [])
    .filter(
      (appointment) =>
        appointment.company === company &&
        !appointment.revokedAt &&
        registerSteps([appointment], appointment.company).prepare,
    )
    .map((appointment) => ({ uuid: appointment.company, name: appointment.companyName }))[0];
  const steps = chosen && appointments.data ? registerSteps(appointments.data, chosen.uuid) : null;
  const anchor = classes.data?.find((token) => token.companyUuid === chosen?.uuid)?.uuid;
  const members = usePeople(
    owner,
    anchor ?? '',
    guard,
    available && !!anchor && !!steps?.prepare,
    orderSubmissionSession,
  );
  const ready =
    available &&
    classes.isSuccess &&
    !classes.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!steps?.prepare &&
    (!anchor || (members.isSuccess && !members.isFetching));
  if (
    !held &&
    ready &&
    chosen &&
    steps &&
    (retained?.company.uuid !== chosen.uuid ||
      retained.company.name !== chosen.name ||
      retained.steps.prepare?.uuid !== steps.prepare?.uuid)
  )
    setRetained({ company: chosen, steps });
  const context = held || !ready ? retained : chosen && steps ? { company: chosen, steps } : retained;
  const current = useRef({ steps, ready });
  useLayoutEffect(() => {
    current.current = { steps, ready };
  }, [steps, ready]);
  const retry = () => {
    void appointments.refetch();
    void classes.refetch();
    if (anchor) void members.refetch();
  };
  const checkCurrent = () => {
    guard();
    for (const key of [
      AUTH_QUERY_KEY,
      USER_PREFERENCES_QUERY_KEY,
      ownAppointmentsKey(owner),
      registerClassesKey(owner),
      ...(anchor ? [peopleKey(owner, anchor)] : []),
    ]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh current company authority and records before continuing.');
    }
    const rows = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
    const appointment = registerSteps(
      rows.filter((item) => !item.revokedAt),
      company,
    ).prepare;
    if (
      !current.current.ready ||
      !appointment ||
      appointment.uuid !== steps?.prepare?.uuid ||
      current.current.steps?.prepare?.uuid !== steps?.prepare?.uuid
    )
      throw createUserFriendlyError('Your company or authority changed. Reopen this action.');
  };
  let content: ReactNode;
  if (classes.isError || appointments.isError || members.isError)
    content = (
      <LoadError retry={retry} busy={classes.isFetching || appointments.isFetching || members.isFetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    );
  else if (!context && (!classes.data || !appointments.data)) content = <Loading>Loading the register…</Loading>;
  else if (appointments.isSuccess && !appointments.isFetching && !steps?.prepare)
    content = <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>;
  else if (!context) content = <CompanyContextNotice />;
  else if (!context.steps.prepare) content = <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>;
  return (
    <Page
      testID="register-setup-scroll"
      title={TITLE}
      available={available && ready && !!context}
      unavailable={
        !available ? <RegisterAccess owner={owner} /> : (content ?? <Loading>Loading the register…</Loading>)
      }
    >
      {context && (
        <FreshClass
          key={`${owner.userUuid}/${context!.company.uuid}`}
          owner={owner}
          guard={guard}
          company={context!.company}
          checkCurrent={checkCurrent}
          classes={(classes.data ?? []).filter((token) => token.companyUuid === context!.company.uuid)}
          companyMembers={(anchor ? (members.data ?? NO_MEMBERS) : NO_MEMBERS).members}
          steps={steps ?? context!.steps}
          ready={ready && chosen?.uuid === context!.company.uuid}
          onHeldChange={setHeld}
          onConflict={retry}
          onContinue={onContinue}
          {...flow}
        />
      )}
      {!!content && <Cancel onCancel={flow.onCancel} />}
    </Page>
  );
}

function FreshClass({
  owner,
  guard,
  checkCurrent,
  company,
  classes,
  companyMembers,
  steps,
  ready,
  onHeldChange,
  onConflict,
  onContinue,
  onCancel,
  onOpen,
  onPrepared,
  onFinished,
}: Flow & {
  owner: OrderSubmissionOwner;
  guard: () => void;
  checkCurrent: () => void;
  company: Pick<Company, 'uuid' | 'name'>;
  classes: CompanyShareTokenListItem[];
  companyMembers: RegisterTransferMember[];
  steps: RegisterSteps;
  ready: boolean;
  onHeldChange: (held: boolean) => void;
  onConflict: () => void;
  onContinue: (token: string) => void;
}) {
  const look = useLedgerStyles();
  const link = useLinkStyle();
  const started = useStartedClasses(
    owner,
    guard,
    company.uuid,
    classes.filter((token) => token.status === 'draft'),
    ready,
    orderSubmissionSession,
  );
  const fresh = useNewShareClass({
    guard,
    checkCurrent,
    company,
    classes,
    started,
    ready,
    session: orderSubmissionSession,
  });
  return (
    <ImportForm
      owner={owner}
      guard={guard}
      newEffectGuard={fresh.check}
      company={company.uuid}
      shareClass={{ name: fresh.name, symbol: fresh.symbol }}
      companyMembers={companyMembers}
      appointment={steps.prepare!}
      steps={steps}
      blocked={!ready}
      visible={ready}
      onConflict={onConflict}
      onHeldChange={onHeldChange}
      resolveRegister={fresh.resolveRegister}
      emptyOpeningAllowed
      classProblems={fresh.problems}
      onCancel={onCancel}
      onPrepared={onPrepared}
      onFinished={onFinished}
      classFields={
        <View style={look.fields}>
          {started.length > 0 && !fresh.classLocked && (
            <Text style={look.muted}>
              Continue a class you started:{' '}
              {started.map((token, index) => (
                <Fragment key={token.uuid}>
                  {index > 0 && ', '}
                  <Text accessibilityRole="link" style={link} onPress={() => onContinue(token.uuid)}>
                    {token.name} · {token.symbol}
                  </Text>
                </Fragment>
              ))}
              .
            </Text>
          )}
          <Choices
            legend="Share class"
            options={REGISTER_SETUP_CHOICES}
            value={fresh.choice}
            disabled={fresh.classLocked}
            onChange={fresh.choose}
          />
          {classes.some((token) => token.status !== 'draft') && (
            <Text style={look.muted}>
              For existing chain classes,{' '}
              <Text accessibilityRole="link" style={link} onPress={() => onOpen('Ledger')}>
                open Ledger
              </Text>{' '}
              to bring in shareholder particulars.
            </Text>
          )}
          {fresh.choice === 'custom' && (
            <>
              <Field
                label="Class name"
                value={fresh.name}
                maxLength={FIELD_LIMITS.CLASS_NAME}
                editable={!fresh.classLocked}
                onChange={fresh.setName}
              />
              <Field
                label="Class code"
                value={fresh.symbol}
                maxLength={FIELD_LIMITS.CLASS_CODE}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!fresh.classLocked}
                onChange={(symbol) => fresh.setSymbol(symbol.toUpperCase())}
              />
              <Choices
                legend="Class type"
                options={REGISTER_CLASS_TYPES}
                value={fresh.tokenType}
                disabled={fresh.classLocked}
                onChange={fresh.setTokenType}
              />
              <Text style={look.small}>Use the recorded class code of 1–5 letters, such as A or ORD.</Text>
            </>
          )}
          <Text style={look.small}>
            Class code and type do not define the rights attached to the shares. The technical share limit is an
            internal quantity guard, not authorised capital.
          </Text>
        </View>
      }
    />
  );
}

type Retained = {
  listed: CompanyShareTokenListItem;
  register: TokenHoldersResponse;
  steps: RegisterSteps;
  correction?: RegisterImport;
  saved?: RegisterImport;
  members: RegisterTransferMembers;
};

function OwnImport({
  owner,
  currentOwner,
  accountOwner,
  available,
  company,
  token,
  record,
  ...flow
}: Flow & {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accountOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
  token: string;
  record?: string;
}) {
  const look = useLedgerStyles();
  const link = useLinkStyle();
  const client = useQueryClient();
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<Retained | null>(null);
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const accountGuard = useMemo(() => ownerGuard(owner, accountOwner), [owner, accountOwner]);
  const classes = useRegisterClasses(owner, accountGuard, orderSubmissionSession, available);
  const appointments = useOwnAppointments(owner, accountGuard, { session: orderSubmissionSession });
  const listed = classes.data?.find((item) => item.uuid === token);
  const companyMatches = !listed || listed.companyUuid === company;
  const steps =
    companyMatches && listed && appointments.data ? registerSteps(appointments.data, listed.companyUuid) : null;
  const readable = available && !!(steps?.prepare || steps?.approve || steps?.apply);
  const imports = useRegisterImports(owner, token, guard, readable, orderSubmissionSession);
  const members = usePeople(owner, token, guard, readable, orderSubmissionSession);
  const register = useImportRegister(owner, token, readable, guard, orderSubmissionSession);
  const correction = imports.data?.find((proposal) => proposal.status === 'applied' && proposal.correctionAllowed);
  const saved = imports.data?.find((proposal) =>
    record
      ? proposal.uuid === record
      : proposal.status === 'submitted' &&
        proposal.sourceConfirmed &&
        proposal.correctionOf === (correction?.uuid ?? null),
  );
  const fetching =
    classes.isFetching || appointments.isFetching || register.isFetching || imports.isFetching || members.isFetching;
  const stale = classes.isError || appointments.isError || register.isError || imports.isError || members.isError;
  const fresh =
    available && !fetching && !stale && !!listed && readable && !!register.data && !!imports.data && !!members.data;
  const mirrorAllowed = register.data?.initialized || register.data?.token.status === 'draft';
  const correctable =
    mirrorAllowed &&
    (!register.data?.initialized || !imports.data?.some((proposal) => proposal.status === 'applied') || !!correction);
  const canPrepare = !!steps?.prepare && correctable;
  const canOpen = saved ? saved.status !== 'rejected' || canPrepare : canPrepare;
  if (
    !held &&
    fresh &&
    canOpen &&
    (!record || !!saved) &&
    (retained?.register !== register.data ||
      retained?.correction !== correction ||
      retained?.saved !== saved ||
      retained?.members !== members.data ||
      retained?.steps.prepare?.uuid !== steps?.prepare?.uuid ||
      retained?.steps.approve?.uuid !== steps?.approve?.uuid ||
      retained?.steps.apply?.uuid !== steps?.apply?.uuid ||
      retained?.steps.reject?.uuid !== steps?.reject?.uuid)
  )
    setRetained({
      listed: listed!,
      register: register.data!,
      steps: steps!,
      correction,
      saved,
      members: members.data!,
    });
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void register.refetch();
    void imports.refetch();
    void members.refetch();
  };
  const checkNew = () => {
    guard();
    for (const key of [
      registerClassesKey(owner),
      ownAppointmentsKey(owner),
      importRegisterKey(owner, token),
      importsKey(owner, token),
      peopleKey(owner, token),
    ]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh current company authority before continuing.');
    }
    if (!fresh || !canOpen || retained?.listed.companyUuid !== listed?.companyUuid)
      throw createUserFriendlyError('Your company, authority or source records changed. Refresh before continuing.');
  };
  const notice = (children: string) => <Text style={look.muted}>{children}</Text>;
  let content: ReactNode;
  if (!companyMatches) content = notice('This share class is not in a register you can read.');
  else if (!held && fresh && record && !saved)
    content = notice('This saved snapshot is not in the selected share class.');
  else if (!retained || !fresh || !canOpen) {
    if (stale)
      content = (
        <LoadError retry={retry} busy={fetching}>
          The register or your appointments could not be loaded.
        </LoadError>
      );
    else if (
      !classes.data ||
      !appointments.data ||
      fetching ||
      (readable && (!imports.data || !register.data || !members.data))
    )
      content = <Loading>Loading the register…</Loading>;
    else if (!listed) content = notice('This share class is not in a register you can read.');
    else if (!readable) content = notice(COPY.READ_ONLY_NOTE);
    else if (record && imports.data && !saved)
      content = notice('This saved snapshot is not in the selected share class.');
    else if (!mirrorAllowed)
      content = (
        <Section title={`${listed.name} · ${listed.symbol}`}>
          <Text style={look.muted}>This class uses the chain, and the app can’t open its register.</Text>
        </Section>
      );
    else if (!correctable)
      content = (
        <Section title={`${listed.name} · ${listed.symbol}`}>
          <Text style={look.muted}>
            This opening cannot be replaced safely because later entries or linked member records depend on it. Correct
            individual entries in{' '}
            <Text accessibilityRole="link" style={link} onPress={() => flow.onOpen('Corrections')}>
              Corrections
            </Text>
            .
          </Text>
        </Section>
      );
    else if (!canOpen) content = notice(COPY.READ_ONLY_NOTE);
    else content = <Loading>Loading the register…</Loading>;
  }
  return (
    <Page
      testID="register-setup-scroll"
      title={TITLE}
      available={available && fresh && canOpen && companyMatches && (!record || !!saved)}
      unavailable={
        !available ? <RegisterAccess owner={owner} /> : (content ?? <Loading>Loading the register…</Loading>)
      }
    >
      {retained && (
        <ImportForm
          key={`${token}/${retained!.correction?.uuid ?? 'new'}/${retained!.saved?.uuid ?? 'draft'}`}
          owner={owner}
          guard={guard}
          newEffectGuard={checkNew}
          company={retained!.listed.companyUuid}
          shareClass={{ name: retained!.listed.name, symbol: retained!.listed.symbol }}
          register={retained!.register}
          companyMembers={(members.data ?? retained!.members).members}
          emptyOpeningAllowed={
            !!listed &&
            !!register.data &&
            !correction &&
            !imports.data?.some((proposal) => proposal.status === 'applied') &&
            canOpenEmptyRegister(register.data, listed)
          }
          classFields={
            <Rows>
              <Fact label="Class name" inline>
                {retained!.listed.name}
              </Fact>
              <Fact label="Class code" inline>
                {retained!.listed.symbol}
              </Fact>
              <Fact label="Class type" inline>
                {retained!.listed.tokenTypeDisplay || 'Not recorded'}
              </Fact>
              <Fact label="Technical share limit" inline>
                {retained!.listed.totalSupply === TECHNICAL_SHARE_LIMIT
                  ? REGISTER_COPY.QUANTITY_GUARD
                  : formatShareCount(retained!.listed.totalSupply)}
              </Fact>
            </Rows>
          }
          appointment={canPrepare ? steps?.prepare : undefined}
          steps={steps ?? retained!.steps}
          correction={retained!.correction}
          saved={retained!.saved}
          blocked={!fresh}
          visible={fresh}
          onConflict={retry}
          onHeldChange={setHeld}
          onCancel={flow.onCancel}
          onPrepared={flow.onPrepared}
          onFinished={flow.onFinished}
        />
      )}
      {!!content && <Cancel onCancel={flow.onCancel} />}
    </Page>
  );
}
