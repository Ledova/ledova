import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { registerAppointmentsKey, useRegisterAppointments, useTransferMembers } from './useCompanyRegister';
import { awardsKey, useRegisterAwards } from './useRegisterAwards';

export function ClassAwards({
  company,
  register,
  epoch,
  sourceReady,
  onPrepareGrant,
  onHeldChange,
}: {
  company: string;
  register: TokenHoldersResponse;
  epoch: number;
  sourceReady: boolean;
  onPrepareGrant: (award: string) => void;
  onHeldChange?: (key: string, held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const sourceAvailable = useRef(sourceReady);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [recordHolds, setRecordHolds] = useState<Record<string, boolean>>({});
  const live = useRef(true);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const readable =
    appointments.isSuccess && !appointments.isFetching && hasCurrentRegisterReadAuthority(appointments.data, company);
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
  const awards = useRegisterAwards(epoch, company, register.token.uuid, guard, readable && sourceReady);
  const recordGuard = () => {
    guard();
    const state = client.getQueryState(awardsKey(epoch, register.token.uuid));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the employee awards before opening their records.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(epoch, register.token.uuid, !!editing && !!appointment && supported);
  const privateReady = readable && sourceReady && awards.isSuccess && !awards.isFetching;
  const recordHeld = useCallback(
    (uuid: string, value: boolean) =>
      setRecordHolds((previous) => (previous[uuid] === value ? previous : { ...previous, [uuid]: value })),
    [],
  );
  const held = formHeld || Object.values(recordHolds).some(Boolean);
  useEffect(() => {
    onHeldChange?.(`awards/${register.token.uuid}`, held);
  }, [onHeldChange, register.token.uuid, held]);
  useEffect(() => () => onHeldChange?.(`awards/${register.token.uuid}`, false), [onHeldChange, register.token.uuid]);
  const blocked =
    (!appointment && !held) ||
    !readable ||
    !sourceReady ||
    awards.isFetching ||
    awards.isError ||
    appointments.isFetching ||
    appointments.isError ||
    !supported;
  const refresh = async (throwOnError = false) => {
    assertSessionEpoch(epoch);
    await appointments.refetch({ throwOnError });
    guard();
    await awards.refetch({ throwOnError });
    guard();
  };
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
      {(editing || appointment) && supported && privateReady && (
        <Action
          label={editing ? 'Close award form' : COPY.PREPARE}
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
              label="Retry award recipients"
              disabled={members.isFetching}
              onPress={() => void members.refetch()}
            />
          </>
        ) : null)}
      {editing && (
        <AwardForm
          key={`${company}/${register.token.uuid}/${editing.uuid}`}
          company={company}
          token={register.token.uuid}
          epoch={epoch}
          members={members.data ?? []}
          appointment={editing}
          guard={recordGuard}
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
            disabled={!sourceReady || awards.isFetching || appointments.isFetching}
            onPress={() => void refresh().catch(() => {})}
          />
          {privateReady && awards.data?.length === 0 && <Text style={styles.muted}>{COPY.EMPTY}</Text>}
        </>
      )}
      {awards.data?.map((award) => (
        <AwardRecord
          key={award.uuid}
          award={award}
          epoch={epoch}
          appointment={appointment}
          guard={recordGuard}
          blocked={blocked}
          visible={privateReady}
          onHeldChange={recordHeld}
          onSettled={() => refresh(true)}
          onPrepareGrant={onPrepareGrant}
        />
      ))}
    </View>
  );
}
