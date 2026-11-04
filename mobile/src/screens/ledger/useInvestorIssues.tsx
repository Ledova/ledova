import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_ALLOTMENT_COPY as COPY,
  allPeopleKey,
  allotmentsKey,
  appointmentForRegisterStep,
  entriesKey,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  peopleFrom,
  registerHoldersKey,
  registerSteps,
  useOwnAppointments,
  usePeople,
  useRegisterAllotments,
  type IssueRow,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading, Rows } from '../../components/Ledger';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AllotmentRecord } from './AllotmentRecord';
import { AllotmentForm } from './IssueForms';
import { useLedgerStyles } from './useLedgerStyles';

export function useInvestorIssues({
  owner,
  company,
  register,
  guard,
  sourceReady,
  onHeldChange,
  issueMember,
  open,
  kept,
  onClosed,
  reviewing,
  onReviewChange,
  onFocusRecord,
  onSetup,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onHeldChange: (held: boolean) => void;
  issueMember?: string;
  open: boolean;
  kept: boolean;
  onClosed: (recorded?: boolean) => void;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  onFocusRecord: (record: View) => void;
  onSetup: () => void;
}) {
  const look = useLedgerStyles();
  const client = useQueryClient();
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [prepared, setPrepared] = useState('');
  const [decisionHolds, setDecisionHolds] = useState<Record<string, boolean>>({});
  const live = useRef(true);
  const writeReady = useRef(false);
  const sourceAvailable = useRef(sourceReady);
  const privateAvailable = useRef(false);
  const appointments = useOwnAppointments(owner, guard, { session: orderSubmissionSession });
  const readable =
    appointments.isSuccess && !appointments.isFetching && hasCurrentRegisterReadAuthority(appointments.data, company);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const authority = useMemo(
    () => () => {
      guard();
      if (!live.current) throw new Error('This allotment section is no longer open.');
      const state = client.getQueryState(ownAppointmentsKey(owner));
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw new Error('Refresh the register and current company appointments.');
      const current = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
      if (!hasCurrentRegisterReadAuthority(current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company, client, owner],
  );
  const check = useMemo(
    () => () => {
      authority();
      if (!sourceAvailable.current) throw new Error('Refresh the register and current company appointments.');
    },
    [authority],
  );
  const token = register.token.uuid;
  const allotments = useRegisterAllotments(
    owner,
    company,
    token,
    check,
    readable && sourceReady,
    orderSubmissionSession,
  );
  const financialGuard = () => {
    check();
    const current = client.getQueryState(allotmentsKey(owner, token));
    if (!privateAvailable.current || current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Refresh the external allotments before reading private sources.');
  };
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const supported = register.initialized && register.token.status === 'draft';
  const members = usePeople(
    owner,
    token,
    check,
    (open || !!editing) && !!appointment && supported && sourceReady,
    orderSubmissionSession,
  );
  const financialReady = allotments.isSuccess && allotments.fetchStatus === 'idle';
  const privateReady = readable && financialReady && sourceReady && !appointments.isError;
  const blocked =
    !readable ||
    !financialReady ||
    !sourceReady ||
    allotments.isFetching ||
    allotments.isError ||
    appointments.isFetching ||
    appointments.isError ||
    !supported;
  useLayoutEffect(() => {
    writeReady.current = !blocked;
    privateAvailable.current = privateReady;
  }, [blocked, privateReady]);
  const recordHeld = useCallback((uuid: string, held: boolean) => {
    setDecisionHolds((current) => (current[uuid] === held ? current : { ...current, [uuid]: held }));
  }, []);
  const held = formHeld || Object.values(decisionHolds).some(Boolean);
  if (
    open &&
    !editing &&
    appointment &&
    supported &&
    privateReady &&
    !blocked &&
    !held &&
    (!issueMember || (members.isSuccess && !members.isFetching))
  )
    setEditing(appointment);
  if (!kept && editing && !formHeld) setEditing(null);
  useEffect(() => {
    onHeldChange(held);
    return () => onHeldChange(false);
  }, [onHeldChange, held]);
  const refresh = async (throwOnError = false) => {
    guard();
    await appointments.refetch({ throwOnError });
    check();
    await allotments.refetch({ throwOnError });
    check();
    await Promise.all([
      client.invalidateQueries({ queryKey: registerHoldersKey(owner) }),
      client.invalidateQueries({ queryKey: entriesKey(owner, token) }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
    ]);
  };
  const setup = !supported && (
    <>
      {sourceReady && (
        <Text style={look.muted}>
          {register.token.status === 'draft'
            ? 'Set up this share register before issuing shares.'
            : 'Issues for a class that uses the chain aren’t available in the app.'}
        </Text>
      )}
      {appointment && privateReady && register.token.status === 'draft' && (
        <Rows>
          <LinkRow
            label={DESTINATIONS.companyRegisterImport.title}
            accessibilityLabel={`${DESTINATIONS.companyRegisterImport.title} (${register.token.name})`}
            onPress={onSetup}
          />
        </Rows>
      )}
    </>
  );
  const form = editing && (
    <View style={[look.fields, !open && look.hidden]}>
      <Text style={look.muted}>
        Record the investment agreement and company receipt, then prepare the share issue for approval.
      </Text>
      {members.isPending ? (
        <Loading>Loading retained recipients…</Loading>
      ) : members.isError ? (
        <LoadError retry={() => members.refetch()} busy={members.isFetching}>
          The retained recipients could not be loaded.
        </LoadError>
      ) : null}
      <AllotmentForm
        key={`${company}/${token}/${editing.uuid}/${issueMember ?? ''}`}
        company={company}
        token={token}
        classLabel={`${register.token.name} (${register.token.symbol})`}
        people={peopleFrom(members.data)}
        initialMember={issueMember}
        appointment={editing}
        guard={financialGuard}
        newEffectGuard={() => {
          if (
            !writeReady.current ||
            appointmentForRegisterStep(
              client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
              company,
              'prepare',
            )?.uuid !== editing.uuid
          )
            throw new Error('Refresh the register and your preparation appointment.');
        }}
        blocked={blocked || members.isFetching}
        visible={privateReady && members.isSuccess && !members.isFetching}
        onHeldChange={setFormHeld}
        onCancel={() => onClosed()}
        onRecorded={async (uuid) => {
          check();
          await refresh(true);
          authority();
          setPrepared(uuid);
          setEditing(null);
          onClosed(true);
        }}
      />
    </View>
  );
  const status = (
    <>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {appointments.isSuccess && !appointment && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {appointments.isError ? null : !appointments.isSuccess || appointments.isFetching ? (
        <Loading>Loading external allotments…</Loading>
      ) : !readable ? (
        <Text style={look.muted}>A current company register appointment is required to read external allotments.</Text>
      ) : allotments.isPending || allotments.isFetching || !sourceReady ? (
        <Loading>Loading external allotments…</Loading>
      ) : allotments.isError ? (
        <LoadError retry={() => refresh().catch(() => {})} busy={allotments.isFetching || appointments.isFetching}>
          External allotments could not be loaded.
        </LoadError>
      ) : null}
    </>
  );
  const steps = registerSteps(appointments.isSuccess ? appointments.data : [], company);
  const listed = privateReady && !kept;
  const records: IssueRow<ReactNode>[] = (allotments.data ?? []).map((allotment) => ({
    uuid: allotment.uuid,
    stage: allotment.stage,
    companyEventOn: allotment.companyEventOn,
    createdAt: allotment.createdAt,
    shown: listed,
    held: !!decisionHolds[allotment.uuid],
    render: ({ collapsed, ruled }) => (
      <AllotmentRecord
        allotment={allotment}
        steps={steps}
        guard={financialGuard}
        visible={listed}
        collapsed={collapsed}
        focusKey={prepared === allotment.uuid ? prepared : undefined}
        onFocus={onFocusRecord}
        reviewing={reviewing}
        onReviewChange={onReviewChange}
        ruled={ruled}
        onHeldChange={recordHeld}
        newEffectGuard={(kind) => {
          check();
          if (
            !writeReady.current ||
            !appointmentForRegisterStep(
              client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
              company,
              kind,
            )
          )
            throw new Error('Refresh the register and your appointment before a new decision.');
        }}
        onSettled={() => refresh(true)}
      />
    ),
  }));
  return {
    setup,
    form,
    status,
    records,
    empty: privateReady && allotments.data?.length === 0,
    held,
    prepare: !!appointment && supported,
    formShown: !!editing && open && privateReady && members.isSuccess && !members.isFetching,
    refreshRecords: () => allotments.refetch({ cancelRefetch: false, throwOnError: true }),
  };
}
