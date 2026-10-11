import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  hasCurrentRegisterReadAuthority,
  appointmentForRegisterStep,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { entriesKey, registerKey } from './useCompanyRegister';
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
}: {
  company: string;
  register: TokenHoldersResponse;
  epoch: number;
  sourceReady: boolean;
}) {
  const client = useQueryClient();
  const styles = useCompanyStyles();
  const [editing, setEditing] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  const live = useRef(true);
  const writeReady = useRef(false);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], company);
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
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [epoch, company],
  );
  const allotments = useRegisterAllotments(epoch, company, register.token.uuid, guard, readable);
  const financialGuard = () => {
    guard();
    const current = client.getQueryState(allotmentsKey(epoch, register.token.uuid));
    if (current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Refresh the external allotments before reading private sources.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(epoch, register.token.uuid, editing && !!appointment && supported);
  const financialReady = allotments.isSuccess && allotments.fetchStatus === 'idle';
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
  }, [blocked]);
  const refresh = async (throwOnError = false) => {
    guard();
    await Promise.all([allotments.refetch({ throwOnError }), appointments.refetch({ throwOnError })]);
    guard();
    await Promise.all([
      client.invalidateQueries({ queryKey: [...registerKey(epoch), 'holders'] }),
      client.invalidateQueries({ queryKey: entriesKey(epoch, register.token.uuid) }),
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
      {appointment && supported && (
        <Action
          label={editing ? 'Close allotment form' : COPY.PREPARE}
          disabled={blocked || formHeld}
          onPress={() => setEditing((value) => !value)}
        />
      )}
      {editing &&
        appointment &&
        supported &&
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
        ) : (
          <AllotmentForm
            key={`${company}/${register.token.uuid}/${appointment.uuid}`}
            company={company}
            token={register.token.uuid}
            epoch={epoch}
            members={members.data}
            appointment={appointment}
            guard={financialGuard}
            newEffectGuard={() => {
              if (
                !writeReady.current ||
                appointmentForRegisterStep(latestAppointments.current, company, 'prepare')?.uuid !== appointment.uuid
              )
                throw new Error('Refresh the register and your preparation appointment.');
            }}
            blocked={blocked || members.isFetching}
            onHeldChange={setFormHeld}
            onRecorded={async () => {
              guard();
              await refresh(true);
              guard();
              setEditing(false);
            }}
          />
        ))}
      {!readable ? (
        <Text style={styles.muted}>
          A current company register appointment is required to read external allotments.
        </Text>
      ) : allotments.isPending || allotments.isFetching ? (
        <Text style={styles.muted}>Loading external allotments…</Text>
      ) : (
        <>
          {allotments.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              External allotments could not be read. A current company register appointment is required.
            </Text>
          )}
          <Action
            label={allotments.isError ? 'Retry allotments' : 'Refresh allotments'}
            disabled={allotments.isFetching || appointments.isFetching}
            onPress={() => void refresh().catch(() => {})}
          />
          {financialReady && allotments.data?.length === 0 ? (
            <Text style={styles.muted}>{COPY.EMPTY}</Text>
          ) : (
            financialReady &&
            allotments.data?.map((allotment) => (
              <AllotmentRecord
                key={allotment.uuid}
                allotment={allotment}
                epoch={epoch}
                steps={steps ?? {}}
                guard={financialGuard}
                newEffectGuard={(kind) => {
                  guard();
                  if (!writeReady.current || !appointmentForRegisterStep(latestAppointments.current, company, kind))
                    throw new Error('Refresh the register and your appointment before a new decision.');
                }}
                onSettled={() => refresh(true)}
              />
            ))
          )}
        </>
      )}
    </View>
  );
}
