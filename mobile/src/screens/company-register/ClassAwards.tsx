import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_AWARD_COPY as COPY,
  hasCurrentRegisterReadAuthority,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { assertSessionEpoch } from '../../services/sessionScope';
import { AwardForm } from './AwardForm';
import { AwardRecord } from './AwardRecord';
import { useCompanyStyles } from './styles';
import { useRegisterAppointments, useTransferMembers } from './useCompanyRegister';
import { useRegisterAwards } from './useRegisterAwards';

export function ClassAwards({
  company,
  register,
  epoch,
  sourceReady,
  onPrepareGrant,
}: {
  company: string;
  register: TokenHoldersResponse;
  epoch: number;
  sourceReady: boolean;
  onPrepareGrant: (award: string) => void;
}) {
  const styles = useCompanyStyles();
  const [editing, setEditing] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  const live = useRef(true);
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
      if (!live.current) throw new Error('This award section is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [epoch, company],
  );
  const awards = useRegisterAwards(epoch, company, register.token.uuid, guard, readable);
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(epoch, register.token.uuid, editing && !!appointment && supported);
  const blocked =
    !readable ||
    !sourceReady ||
    awards.isFetching ||
    awards.isError ||
    appointments.isFetching ||
    appointments.isError ||
    !supported;
  const refresh = (throwOnError = false) =>
    Promise.all([awards.refetch({ throwOnError }), appointments.refetch({ throwOnError })]);
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{COPY.TITLE}</Text>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      {appointments.isError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            Your appointments could not be read. Retry before recording an award.
          </Text>
          <Action
            label="Retry award appointments"
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </>
      )}
      {appointments.isSuccess && !appointment && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {appointment && supported && (
        <Action
          label={editing ? 'Close award form' : COPY.PREPARE}
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
              label="Retry award recipients"
              disabled={members.isFetching}
              onPress={() => void members.refetch()}
            />
          </>
        ) : (
          <AwardForm
            key={`${company}/${register.token.uuid}/${appointment.uuid}`}
            company={company}
            token={register.token.uuid}
            epoch={epoch}
            members={members.data}
            appointment={appointment}
            guard={guard}
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
        <Text style={styles.muted}>A current company register appointment is required to read employee awards.</Text>
      ) : awards.isPending ? (
        <Text style={styles.muted}>Loading employee awards…</Text>
      ) : (
        <>
          {awards.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              Employee awards could not be read. A current company register appointment is required.
            </Text>
          )}
          <Action
            label={awards.isError ? 'Retry awards' : 'Refresh awards'}
            disabled={awards.isFetching || appointments.isFetching}
            onPress={() => void refresh()}
          />
          {awards.data?.length === 0 ? (
            <Text style={styles.muted}>{COPY.EMPTY}</Text>
          ) : (
            awards.data?.map((award) => (
              <AwardRecord
                key={award.uuid}
                award={award}
                epoch={epoch}
                appointment={appointment}
                guard={guard}
                blocked={blocked}
                onSettled={() => refresh(true)}
                onPrepareGrant={onPrepareGrant}
              />
            ))
          )}
        </>
      )}
    </View>
  );
}
