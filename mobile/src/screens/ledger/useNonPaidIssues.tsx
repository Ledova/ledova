import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_GRANT_COPY as COPY,
  allPeopleKey,
  appointmentForRegisterStep,
  awardsKey,
  entriesKey,
  grantsKey,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  peopleFrom,
  registerHoldersKey,
  registerSteps,
  useOwnAppointments,
  usePeople,
  useRegisterAward,
  useRegisterGrants,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RecordRow,
  type RegisterDecisionKind,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LoadError, Loading } from '../../components/Ledger';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { GrantRecord } from './GrantRecord';
import { GrantForm } from './IssueForms';
import { useLedgerStyles } from './useLedgerStyles';

export function useNonPaidIssues({
  owner,
  guard,
  register,
  company,
  sourceReady,
  onHeldChange,
  award: awardUuid = '',
  focusRecord,
  open,
  kept,
  onClosed,
  reviewing,
  onReviewChange,
  onFocusRecord,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
  sourceReady: boolean;
  onHeldChange: (held: boolean) => void;
  award?: string;
  focusRecord?: { key: string; uuid: string };
  open: boolean;
  kept: boolean;
  onClosed: (recorded?: boolean) => void;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  onFocusRecord: (record: View) => void;
}) {
  const look = useLedgerStyles();
  const client = useQueryClient();
  const token = register.token.uuid;
  const source = useRef(sourceReady);
  useLayoutEffect(() => {
    source.current = sourceReady;
  }, [sourceReady]);
  const appointments = useOwnAppointments(owner, guard, { session: orderSubmissionSession });
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], company);
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
  const grants = useRegisterGrants(
    owner,
    company,
    token,
    check,
    readable && !appointments.isFetching && sourceReady,
    orderSubmissionSession,
  );
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : {};
  const privateReady = sourceReady && readable && grants.isSuccess && !grants.isFetching && !appointments.isFetching;
  const privateGuard = () => {
    check();
    const state = client.getQueryState(grantsKey(owner, token));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the non-paid issues before continuing.');
  };
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
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [prepared, setPrepared] = useState('');
  const held = formHeld || heldRecords.size > 0;
  useEffect(() => {
    onHeldChange(held);
    return () => onHeldChange(false);
  }, [held, onHeldChange]);
  const refresh = async () => {
    guard();
    await appointments.refetch({ throwOnError: true });
    check();
    await grants.refetch({ throwOnError: true });
    check();
    await Promise.all(
      [awardsKey(owner, token), registerHoldersKey(owner), entriesKey(owner, token), allPeopleKey(owner)].map(
        (queryKey) => client.invalidateQueries({ queryKey }),
      ),
    );
  };
  const supported = register.initialized && register.token.status === 'draft';
  const newEffectGuard = (kind: RegisterDecisionKind) => {
    privateGuard();
    const rows = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
    if (!supported || !appointmentForRegisterStep(rows, company, kind))
      throw new Error('Current company authority is required for this issue.');
  };
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const reading = (open || !!formAppointment) && !!appointment && supported && sourceReady;
  const people = usePeople(owner, token, check, reading, orderSubmissionSession);
  const award = useRegisterAward(owner, company, token, awardUuid, check, reading, orderSubmissionSession);
  const awardMember = people.data?.members.find((row) => row.member === award.data?.member) ?? null;
  const recipientReady =
    !awardUuid || (award.isSuccess && people.isSuccess && !!awardMember?.walletless && awardMember.particularsRetained);
  const busy = appointments.isFetching || people.isFetching || (!!awardUuid && award.isFetching);
  const stale = appointments.isError || people.isError || (!!awardUuid && award.isError);
  const ready =
    sourceReady &&
    readable &&
    people.isSuccess &&
    (!awardUuid || award.isSuccess) &&
    (!!formAppointment || (!!appointment && supported && recipientReady));
  const formVisible = ready && !stale && !busy;
  if (
    open &&
    formVisible &&
    appointment &&
    (!formAppointment || (!formHeld && formAppointment.uuid !== appointment.uuid))
  )
    setFormAppointment(appointment);
  if (!kept && formAppointment && !formHeld) setFormAppointment(null);
  const retry = async () => {
    await appointments.refetch();
    void client.invalidateQueries({ queryKey: registerHoldersKey(owner) });
    if (reading) {
      void people.refetch();
      if (awardUuid) void award.refetch();
    }
  };
  const shown = open || formHeld;
  const form = (shown || !!formAppointment) && (
    <View style={[look.fields, !shown && look.hidden]}>
      {stale ? (
        <LoadError retry={retry} busy={busy}>
          The non-paid issue form could not be loaded.
        </LoadError>
      ) : appointments.isSuccess && !appointment && !formAppointment ? (
        <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>
      ) : award.isSuccess && people.isSuccess && !recipientReady ? (
        <Text style={look.muted}>
          This award’s recipient needs current retained walletless particulars before a grant can be prepared.
        </Text>
      ) : (
        !formVisible && <Loading>Loading the non-paid issue form…</Loading>
      )}
      {formAppointment && (
        <GrantForm
          key={`${formAppointment.uuid}/${awardUuid}`}
          owner={owner}
          guard={check}
          company={company}
          token={token}
          people={peopleFrom(people.data)}
          appointment={formAppointment}
          blocked={!ready || stale || busy}
          visible={formVisible}
          onHeldChange={setFormHeld}
          canPrepare={
            supported &&
            recipientReady &&
            !!appointmentForRegisterStep(
              appointments.isSuccess ? appointments.data.filter((item) => item.uuid === formAppointment.uuid) : [],
              company,
              'prepare',
            )
          }
          onRefused={retry}
          onCancel={() => onClosed()}
          onRecorded={(uuid) => {
            setPrepared(uuid);
            setFormAppointment(null);
            onClosed(true);
          }}
          award={awardUuid ? award.data : undefined}
          awardMember={awardMember}
        />
      )}
    </View>
  );
  const status = (
    <>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {readable && !Object.values(steps).some(Boolean) && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {appointments.isError ? null : !appointments.isSuccess ||
        appointments.isFetching ||
        !sourceReady ||
        (readable && (grants.isPending || grants.isFetching)) ? (
        <Loading>Loading non-paid issues…</Loading>
      ) : !readable ? (
        <Text style={look.muted}>A current company register appointment is required to read non-paid issues.</Text>
      ) : grants.isError ? (
        <LoadError retry={() => refresh().catch(() => {})} busy={grants.isFetching || appointments.isFetching}>
          Non-paid issues could not be loaded.
        </LoadError>
      ) : null}
    </>
  );
  const listed = privateReady && !kept;
  const records: RecordRow<ReactNode>[] = (grants.data ?? []).map((grant) => ({
    uuid: grant.uuid,
    stage: grant.stage,
    companyEventOn: grant.companyEventOn,
    createdAt: grant.createdAt,
    shown: listed,
    held: heldRecords.has(grant.uuid),
    render: ({ collapsed, ruled }) => (
      <GrantRecord
        grant={grant}
        steps={steps}
        guard={privateGuard}
        newEffectGuard={newEffectGuard}
        visible={listed}
        collapsed={collapsed}
        focusKey={focusRecord?.uuid === grant.uuid ? focusRecord.key : prepared === grant.uuid ? prepared : undefined}
        onFocus={onFocusRecord}
        onHeldChange={recordHeld}
        onSettled={refresh}
        classLabel={`${register.token.name} (${register.token.symbol})`}
        reviewing={reviewing}
        onReviewChange={onReviewChange}
        ruled={ruled}
      />
    ),
  }));
  return {
    form,
    status,
    records,
    empty: privateReady && grants.data?.length === 0,
    held,
    formShown: shown && !!formAppointment && formVisible,
    refreshRecords: () => grants.refetch({ cancelRefetch: false, throwOnError: true }),
  };
}
