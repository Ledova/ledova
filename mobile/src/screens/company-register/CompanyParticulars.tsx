import { useLayoutEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_PARTICULARS_COPY as COPY,
  hasCurrentRegisterReadAuthority,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { ParticularsRecord } from './ParticularsRecord';
import { useCompanyStyles } from './styles';
import {
  entriesKey,
  particularsKey,
  registerAppointmentsKey,
  useRegisterAppointments,
  useRegisterParticulars,
} from './useCompanyRegister';

export function CompanyParticulars({
  epoch,
  company,
  registers,
  refreshHolders,
  sourceReady = true,
  onHeldChange,
}: {
  sourceReady?: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
  epoch: number;
  company: string;
  registers: TokenHoldersResponse[];
  refreshHolders: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const sourceAvailable = useRef(sourceReady);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  const queryClient = useQueryClient();
  const changes = useRegisterParticulars(epoch, company);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const privateReady =
    sourceReady &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    changes.isSuccess &&
    !changes.isFetching &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const guard = () => {
    const authority = queryClient.getQueryState(registerAppointmentsKey(epoch));
    const state = queryClient.getQueryState(particularsKey(epoch, company));
    if (
      !sourceAvailable.current ||
      authority?.status !== 'success' ||
      authority.fetchStatus !== 'idle' ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(
        queryClient.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
        company,
      )
    )
      throw new Error('Refresh the company records and current appointments.');
  };
  const names = new Map(
    registers.flatMap(({ holders }) => holders.flatMap(({ member, name }) => (name ? [[member, name] as const] : []))),
  );
  const settle = () =>
    Promise.all([
      changes.refetch(),
      refreshHolders(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch), type: 'active' }),
      appointments.refetch(),
    ]);
  return (
    <Section title={COPY.TITLE}>
      {appointments.isError && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Your appointments could not be read, so particulars change actions are hidden.
          </Text>
          <Action
            label="Retry appointments"
            accessibilityLabel="Retry appointments for particulars changes"
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </View>
      )}
      {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {changes.isPending ? (
        <Text style={styles.muted}>Loading particulars changes…</Text>
      ) : changes.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The particulars changes could not be loaded.
          </Text>
          <Action
            label="Retry particulars changes"
            disabled={changes.isFetching}
            onPress={() => void changes.refetch()}
          />
        </View>
      ) : privateReady && changes.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : null}
      {changes.data?.map((change, index) => (
        <ParticularsRecord
          key={change.uuid}
          change={change}
          member={names.get(change.member) ?? COPY.UNNAMED_MEMBER}
          epoch={epoch}
          steps={steps}
          last={index === changes.data!.length - 1}
          onSettled={settle}
          visible={privateReady}
          guard={guard}
          onHeldChange={onHeldChange}
        />
      ))}
    </Section>
  );
}
