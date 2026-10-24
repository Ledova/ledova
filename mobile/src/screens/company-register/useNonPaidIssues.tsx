import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_GRANT_COPY as COPY,
  hasCurrentRegisterReadAuthority,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { GrantRecord } from './GrantRecord';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import {
  entriesKey,
  grantsKey,
  registerAppointmentsKey,
  transferMembersKey,
  useRegisterGrants,
} from '../../hooks/useCompanyRegister';
import { assertSessionEpoch } from '../../services/sessionScope';
import { awardsKey } from './useRegisterAwards';

export function useNonPaidIssues({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  onPrepare,
  sourceReady,
  onHeldChange,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
  onPrepare: () => void;
  sourceReady: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const sourceAvailable = useRef(sourceReady);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  const [holds, setHolds] = useState<Record<string, boolean>>({});
  const recordHeld = useCallback(
    (key: string, value: boolean) =>
      setHolds((previous) => (previous[key] === value ? previous : { ...previous, [key]: value })),
    [],
  );
  const held = Object.values(holds).some(Boolean);
  useEffect(() => {
    onHeldChange?.(`grants/${register.token.uuid}`, held);
  }, [onHeldChange, register.token.uuid, held]);
  useEffect(() => () => onHeldChange?.(`grants/${register.token.uuid}`, false), [onHeldChange, register.token.uuid]);
  const queryClient = useQueryClient();
  const grants = useRegisterGrants(epoch, company, register.token.uuid);
  const currentAppointments = queryClient.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [];
  const appointmentRead = queryClient.getQueryState(registerAppointmentsKey(epoch));
  const readable =
    appointmentRead?.status === 'success' &&
    appointmentRead.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(currentAppointments, company);
  const privateReady = sourceReady && readable && grants.isSuccess && !grants.isFetching;
  const guard = () => {
    assertSessionEpoch(epoch);
    const authority = queryClient.getQueryState(registerAppointmentsKey(epoch));
    const records = queryClient.getQueryState(grantsKey(epoch, register.token.uuid));
    if (
      !sourceAvailable.current ||
      authority?.status !== 'success' ||
      authority.fetchStatus !== 'idle' ||
      records?.status !== 'success' ||
      records.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(
        queryClient.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
        company,
      )
    )
      throw new Error('Refresh the register and your current company authority.');
  };
  const refresh = async () => {
    await Promise.all([
      refreshHolders(),
      refreshAppointments(),
      queryClient.invalidateQueries({ queryKey: transferMembersKey(epoch, register.token.uuid) }),
    ]);
    await Promise.all([
      grants.refetch(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' }),
      queryClient.refetchQueries({ queryKey: awardsKey(epoch, register.token.uuid), type: 'active' }),
    ]);
  };
  const status = (
    <>
      {readable && steps && !Object.values(steps).some(Boolean) && (
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      )}
      {appointmentRead?.status === 'error' ? null : appointmentRead?.status !== 'success' ||
        appointmentRead.fetchStatus !== 'idle' ||
        !sourceReady ||
        (readable && (grants.isPending || grants.isFetching)) ? (
        <Text style={styles.muted}>Loading non-paid issues…</Text>
      ) : !readable ? (
        <Text style={styles.muted}>A current company register appointment is required to read non-paid issues.</Text>
      ) : grants.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Non-paid issues could not be loaded.
          </Text>
          <Action label="Retry non-paid issues" disabled={grants.isFetching} onPress={() => void refresh()} />
        </View>
      ) : null}
    </>
  );
  const prepare = privateReady && steps?.prepare && register.initialized && register.token.status === 'draft' && (
    <Action
      label={COPY.PREPARE}
      accessibilityLabel={`${COPY.PREPARE} for ${register.token.name}`}
      onPress={onPrepare}
    />
  );
  const records = grants.data?.map((grant, index) => (
    <GrantRecord
      key={grant.uuid}
      grant={grant}
      epoch={epoch}
      steps={steps}
      last={index === grants.data!.length - 1}
      onSettled={refresh}
      visible={privateReady}
      guard={guard}
      onHeldChange={recordHeld}
    />
  ));
  return {
    status,
    records,
    prepare,
    empty: privateReady && grants.data?.length === 0,
    held,
    refreshing: grants.isFetching,
    refresh,
  };
}
