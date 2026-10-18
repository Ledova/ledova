import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  hasCurrentRegisterReadAuthority,
  appointmentForRegisterStep,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { entriesKey, registerAppointmentsKey, transferMembersKey, registerHoldersKey } from './useCompanyRegister';
import { Action } from '../../components/Ledger';
import { assertSessionEpoch } from '../../services/sessionScope';
import { AllotmentForm } from './AllotmentForm';
import { AllotmentRecord } from './AllotmentRecord';
import { useCompanyStyles } from './styles';
import { useRegisterAppointments, useTransferMembers } from './useCompanyRegister';
import { allotmentsKey, useRegisterAllotments } from './useRegisterAllotments';

export function ClassAllotments({
  company,
  register,
  epoch,
  sourceReady,
  onHeldChange,
}: {
  company: string;
  register: TokenHoldersResponse;
  epoch: number;
  sourceReady: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const styles = useCompanyStyles();
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [decisionHolds, setDecisionHolds] = useState<Record<string, boolean>>({});
  const live = useRef(true);
  const sourceAvailable = useRef(sourceReady);
  const privateAvailable = useRef(false);
  const writeReady = useRef(false);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const readable =
    appointments.isSuccess && !appointments.isFetching && hasCurrentRegisterReadAuthority(appointments.data, company);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  const appointment = readable ? steps?.prepare : undefined;
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const guard = useMemo(
    () => () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This allotment section is no longer open.');
      const state = client.getQueryState(registerAppointmentsKey(epoch));
      if (!sourceAvailable.current || state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw new Error('Refresh the register and current company appointments.');
      if (
        !hasCurrentRegisterReadAuthority(
          client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
          company,
        )
      )
        throw new Error('A current company register appointment is required.');
    },
    [epoch, company, client],
  );
  const allotments = useRegisterAllotments(epoch, company, register.token.uuid, guard, readable && sourceReady);
  const financialGuard = () => {
    guard();
    const current = client.getQueryState(allotmentsKey(epoch, register.token.uuid));
    if (!privateAvailable.current || current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Refresh the external allotments before reading private sources.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(epoch, register.token.uuid, !!editing && !!appointment && supported);
  const financialReady = allotments.isSuccess && allotments.fetchStatus === 'idle';
  const privateReady = readable && financialReady && sourceReady;
  const held = formHeld || Object.values(decisionHolds).some(Boolean);
  const blocked =
    (!appointment && !held) ||
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
  const recordHeld = useCallback((uuid: string, value: boolean) => {
    setDecisionHolds((previous) => (previous[uuid] === value ? previous : { ...previous, [uuid]: value }));
  }, []);
  useEffect(() => {
    onHeldChange?.(`allotments/${register.token.uuid}`, held);
  }, [onHeldChange, register.token.uuid, held]);
  useEffect(
    () => () => onHeldChange?.(`allotments/${register.token.uuid}`, false),
    [onHeldChange, register.token.uuid],
  );
  const refresh = async (throwOnError = false) => {
    assertSessionEpoch(epoch);
    await appointments.refetch({ throwOnError });
    guard();
    await allotments.refetch({ throwOnError });
    guard();
    await Promise.all([
      client.invalidateQueries({ queryKey: registerHoldersKey(epoch) }),
      client.invalidateQueries({ queryKey: entriesKey(epoch, register.token.uuid) }),
      client.invalidateQueries({ queryKey: transferMembersKey(epoch, register.token.uuid) }),
    ]);
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{COPY.TITLE}</Text>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      {appointments.isError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            Your appointments could not be read. Retry before recording an allotment.
          </Text>
          <Action
            label="Retry allotment appointments"
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </>
      )}
      {appointments.isSuccess && !appointment && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {(editing || appointment) && supported && privateReady && (
        <Action
          label={editing ? 'Close allotment form' : COPY.PREPARE}
          disabled={blocked || held}
          onPress={() => setEditing((value) => (value ? null : (appointment ?? null)))}
        />
      )}
      {editing &&
        (members.isPending ? (
          <Text style={styles.muted}>Loading retained recipients…</Text>
        ) : members.isError ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              The retained recipients could not be read.
            </Text>
            <Action
              label="Retry allotment recipients"
              disabled={members.isFetching}
              onPress={() => void members.refetch()}
            />
          </>
        ) : null)}
      {editing && (
        <AllotmentForm
          key={`${company}/${register.token.uuid}/${editing.uuid}`}
          company={company}
          token={register.token.uuid}
          epoch={epoch}
          members={members.data ?? []}
          appointment={editing}
          guard={financialGuard}
          newEffectGuard={() => {
            if (
              !writeReady.current ||
              appointmentForRegisterStep(latestAppointments.current, company, 'prepare')?.uuid !== editing.uuid
            )
              throw new Error('Refresh the register and your preparation appointment.');
          }}
          blocked={blocked || members.isFetching}
          visible={privateReady && members.isSuccess && !members.isFetching}
          onHeldChange={setFormHeld}
          onRecorded={async () => {
            guard();
            await refresh(true);
            guard();
            setEditing(null);
          }}
        />
      )}
      {!readable ? (
        <Text style={styles.muted}>
          A current company register appointment is required to read external allotments.
        </Text>
      ) : allotments.isPending || allotments.isFetching || !sourceReady ? (
        <Text style={styles.muted}>Loading external allotments…</Text>
      ) : (
        <>
          {allotments.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              External allotments could not be read. A current company register appointment is required.
            </Text>
          )}
          {privateReady && allotments.data?.length === 0 && <Text style={styles.muted}>{COPY.EMPTY}</Text>}
        </>
      )}
      <Action
        label={allotments.isError ? 'Retry allotments' : 'Refresh allotments'}
        disabled={!sourceReady || allotments.isFetching || appointments.isFetching}
        onPress={() => void refresh().catch(() => {})}
      />
      {allotments.data?.map((allotment) => (
        <AllotmentRecord
          key={allotment.uuid}
          allotment={allotment}
          epoch={epoch}
          steps={steps ?? {}}
          guard={financialGuard}
          visible={privateReady}
          onHeldChange={recordHeld}
          newEffectGuard={(kind) => {
            guard();
            if (!writeReady.current || !appointmentForRegisterStep(latestAppointments.current, company, kind))
              throw new Error('Refresh the register and your appointment before a new decision.');
          }}
          onSettled={() => refresh(true)}
        />
      ))}
    </View>
  );
}
