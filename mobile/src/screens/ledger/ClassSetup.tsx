import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import {
  AUTH_QUERY_KEY,
  DESTINATIONS,
  FIELD_LIMITS,
  REGISTER_CLASS_TYPES,
  REGISTER_IMPORT_COPY as COPY,
  USER_PREFERENCES_QUERY_KEY,
  appointmentForRegisterStep,
  canOpenEmptyRegister,
  createUserFriendlyError,
  importRegisterKey,
  importsKey,
  ownAppointmentsKey,
  peopleKey,
  registerClassesKey,
  registerSteps,
  useImportRegister,
  useNewShareClass,
  useNewClassRights,
  useOwnAppointments,
  usePeople,
  useRegisterClasses,
  useRegisterImports,
  useStartedClasses,
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
import { Action, FormActions, LoadError, Loading, Section } from '../../components/Ledger';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { Choices, Field } from '../../components/Field';
import { useThemedStyles } from '../../contexts';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ImportForm } from './ImportForm';
import { NewClassRights } from './NewClassRights';
import { RightsSummary } from './ClassRights';
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

export function NewClassSetup({
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
  const stale = classes.isError || appointments.isError || members.isError;
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
  const showForm = available && !stale && !!context && !!steps?.prepare && (held || ready);
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
  if (stale)
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
      held={held}
      available={showForm}
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
          visible={showForm}
          onHeldChange={setHeld}
          onConflict={retry}
          onContinue={onContinue}
          administrator={
            appointmentForRegisterStep(
              (appointments.data ?? []).filter((row) => row.capabilities.includes('admin') && !row.revokedAt),
              context.company.uuid,
              'prepare',
            )?.uuid
          }
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
  visible,
  onHeldChange,
  onConflict,
  onContinue,
  onCancel,
  onOpen,
  onPrepared,
  onFinished,
  administrator,
}: Flow & {
  owner: OrderSubmissionOwner;
  guard: () => void;
  checkCurrent: () => void;
  company: Pick<Company, 'uuid' | 'name'>;
  classes: CompanyShareTokenListItem[];
  companyMembers: RegisterTransferMember[];
  steps: RegisterSteps;
  ready: boolean;
  visible: boolean;
  onHeldChange: (held: boolean) => void;
  onConflict: () => void;
  onContinue: (token: string) => void;
  administrator?: string;
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
  const [openingHeld, setOpeningHeld] = useState(false);
  const rights = useNewClassRights({
    owner,
    company: company.uuid,
    check: fresh.check,
    resolveRegister: fresh.resolveRegister,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const rightsHeld = !!rights.editor || rights.pending || rights.busy;
  usePreventRemove(rights.busy || rights.pending, () => {});
  useEffect(() => {
    onHeldChange(openingHeld || rightsHeld);
    return () => onHeldChange(false);
  }, [openingHeld, rightsHeld, onHeldChange]);
  return (
    <ImportForm
      owner={owner}
      guard={guard}
      newEffectGuard={fresh.check}
      company={company.uuid}
      shareClass={{
        name: fresh.name,
        symbol: fresh.symbol,
        type: REGISTER_CLASS_TYPES.find(([type]) => type === fresh.tokenType)?.[1],
      }}
      companyMembers={companyMembers}
      appointment={steps.prepare!}
      steps={steps}
      blocked={!ready || rightsHeld}
      visible={visible}
      onConflict={onConflict}
      onHeldChange={setOpeningHeld}
      resolveRegister={fresh.resolveRegister}
      emptyOpeningAllowed
      classProblems={fresh.problems}
      classContent={
        <NewClassRights
          rights={rights}
          administrator={administrator}
          problems={fresh.problems}
          classLocked={fresh.classLocked}
          blocked={openingHeld}
        />
      }
      classContentHeld={rightsHeld}
      classReview={
        <View style={look.summary}>
          <Text accessibilityRole="header" style={look.title}>
            Class rights
          </Text>
          {rights.saved ? (
            <RightsSummary revision={rights.saved} />
          ) : (
            <Text style={look.muted}>No rights recorded.</Text>
          )}
        </View>
      }
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
            legend="Start with"
            options={fresh.choices}
            value={fresh.choice}
            disabled={fresh.classLocked || !ready}
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
                editable={!fresh.classLocked && ready}
                onChange={fresh.setName}
              />
              <Field
                label="Class code"
                value={fresh.symbol}
                maxLength={FIELD_LIMITS.CLASS_CODE}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!fresh.classLocked && ready}
                onChange={(symbol) => fresh.setSymbol(symbol.toUpperCase())}
              />
              <Choices
                legend="Class type"
                options={REGISTER_CLASS_TYPES}
                value={fresh.tokenType}
                disabled={fresh.classLocked || !ready}
                onChange={fresh.setTokenType}
              />
            </>
          )}
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

export function ClassSetup({
  owner,
  currentOwner,
  accountOwner,
  available,
  company,
  token,
  record,
  externalHeld,
  onHeldChange,
  onRecordsChanged,
  classFields,
  classActions,
  classHeld,
  classContent,
  classReview,
  classContentHeld,
  onCannotOpen,
  ...flow
}: Flow & {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  accountOwner: () => OrderSubmissionOwner | null;
  available: boolean;
  company: string;
  token: string;
  record?: string;
  externalHeld: boolean;
  onHeldChange: (held: boolean) => void;
  onRecordsChanged: () => void;
  classFields: (recordFields: ReactNode) => ReactNode;
  classActions: ReactNode;
  classHeld: boolean;
  classContent: ReactNode;
  classReview: ReactNode;
  classContentHeld: boolean;
  onCannotOpen?: () => void;
}) {
  const look = useLedgerStyles();
  const link = useLinkStyle();
  const client = useQueryClient();
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<Retained | null>(null);
  const [preparedHere, setPreparedHere] = useState<string | null>(null);
  const retaining = held || classHeld || classContentHeld;
  useEffect(() => {
    onHeldChange(held);
    return () => onHeldChange(false);
  }, [held, onHeldChange]);
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
  const previousImports = useRef(imports.data);
  useEffect(() => {
    if (previousImports.current && imports.data && previousImports.current !== imports.data) onRecordsChanged();
    previousImports.current = imports.data;
  }, [imports.data, onRecordsChanged]);
  const members = usePeople(owner, token, guard, readable, orderSubmissionSession);
  const register = useImportRegister(owner, token, readable, guard, orderSubmissionSession);
  const correction = imports.data?.find((proposal) => proposal.status === 'applied' && proposal.correctionAllowed);
  const resumed = record ?? retained?.saved?.uuid;
  const saved = imports.data?.find((proposal) =>
    resumed
      ? proposal.uuid === resumed
      : proposal.status === 'submitted' &&
        proposal.sourceConfirmed &&
        proposal.correctionOf === (correction?.uuid ?? null),
  );
  const savedSource = saved?.uuid === preparedHere ? retained?.saved : saved;
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
  const cannotOpen = !retaining && fresh && !record && !!mirrorAllowed && !!correctable && !canOpen;
  useEffect(() => {
    if (cannotOpen) onCannotOpen?.();
  }, [cannotOpen, onCannotOpen]);
  const showForm =
    available &&
    companyMatches &&
    !!retained &&
    !stale &&
    !!listed &&
    readable &&
    (!record || !!saved) &&
    (retaining || (fresh && canOpen));
  if (
    !retaining &&
    fresh &&
    canOpen &&
    (!record || !!saved) &&
    (retained?.listed !== listed ||
      retained?.register !== register.data ||
      retained?.correction !== correction ||
      retained?.saved !== savedSource ||
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
      saved: savedSource,
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
    if (
      !fresh ||
      !canOpen ||
      externalHeld ||
      classHeld ||
      classContentHeld ||
      (record && !saved) ||
      retained?.listed.companyUuid !== listed?.companyUuid
    )
      throw createUserFriendlyError('Your company, authority or source records changed. Refresh before continuing.');
  };
  const notice = (children: string) => <Text style={look.muted}>{children}</Text>;
  let content: ReactNode;
  if (!companyMatches) content = notice('This share class is not in a register you can read.');
  else if (fresh && record && !saved) content = notice('This saved snapshot is not in the selected share class.');
  else if (!retained || stale || !listed || !readable || (!retaining && (!fresh || !canOpen))) {
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
    <View
      testID="class-setup"
      style={look.fields}
      accessibilityElementsHidden={!available}
      importantForAccessibility={available ? 'auto' : 'no-hide-descendants'}
    >
      {available && content}
      <View style={!showForm && look.hidden}>
        {retained && (
          <ImportForm
            key={`${token}/${retained!.correction?.uuid ?? 'new'}/${retained!.saved?.uuid ?? 'draft'}`}
            owner={owner}
            guard={guard}
            newEffectGuard={checkNew}
            company={retained!.listed.companyUuid}
            shareClass={{
              name: listed?.name ?? retained!.listed.name,
              symbol: listed?.symbol ?? retained!.listed.symbol,
              type: listed?.tokenTypeDisplay ?? retained!.listed.tokenTypeDisplay,
            }}
            register={retained!.register}
            companyMembers={(members.data ?? retained!.members).members}
            emptyOpeningAllowed={
              !!listed &&
              !!register.data &&
              !correction &&
              !imports.data?.some((proposal) => proposal.status === 'applied') &&
              canOpenEmptyRegister(register.data, listed)
            }
            classFields={classFields}
            classActions={classActions}
            classHeld={classHeld}
            classContent={classContent}
            classReview={classReview}
            classContentHeld={classContentHeld}
            appointment={canPrepare ? steps?.prepare : undefined}
            steps={steps ?? retained!.steps}
            correction={retained!.correction}
            saved={retained!.saved}
            blocked={!fresh || !canOpen || externalHeld || classHeld}
            visible={showForm}
            onConflict={retry}
            onHeldChange={setHeld}
            onCancel={flow.onCancel}
            onPrepared={(prepared, saved) => {
              setPreparedHere(saved);
              flow.onPrepared(prepared, saved);
            }}
            onFinished={flow.onFinished}
          />
        )}
      </View>
      {!!content && <Cancel onCancel={flow.onCancel} />}
    </View>
  );
}
