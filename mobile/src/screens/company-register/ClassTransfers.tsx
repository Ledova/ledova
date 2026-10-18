import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_TRANSFER_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { TransferRecord } from './TransferRecord';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { entriesKey, transfersKey, transferMembersKey, useRegisterTransfers } from '../../hooks/useCompanyRegister';

export function ClassTransfers({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  onPrepare,
  sourceReady = true,
  guard,
  onHeldChange,
}: {
  sourceReady?: boolean;
  guard?: () => void;
  onHeldChange?: (key: string, held: boolean) => void;
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
  onPrepare: () => void;
}) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const transfers = useRegisterTransfers(epoch, company, register.token.uuid);
  const privateReady = sourceReady && transfers.isSuccess && !transfers.isFetching;
  const recordGuard = () => {
    guard?.();
    const state = queryClient.getQueryState(transfersKey(epoch, register.token.uuid));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the register records before continuing.');
  };
  const settle = () =>
    Promise.all([
      transfers.refetch(),
      refreshHolders(),
      refreshAppointments(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' }),
      queryClient.invalidateQueries({ queryKey: transferMembersKey(epoch, register.token.uuid) }),
    ]);
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{COPY.TITLE}</Text>
      {privateReady && steps?.prepare && register.initialized && register.token.status === 'draft' && (
        <Action
          label={COPY.PREPARE}
          accessibilityLabel={`${COPY.PREPARE} for ${register.token.name}`}
          onPress={onPrepare}
        />
      )}
      {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {transfers.isPending ? (
        <Text style={styles.muted}>Loading non-paid transfers…</Text>
      ) : transfers.isError ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            The transfers could not be loaded.
          </Text>
          <Action label="Retry transfers" disabled={transfers.isFetching} onPress={() => void transfers.refetch()} />
        </>
      ) : privateReady && transfers.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : null}
      <Action label="Refresh transfers" disabled={transfers.isFetching} onPress={() => void settle()} />
      {transfers.data?.map((transfer, index) => (
        <TransferRecord
          key={transfer.uuid}
          transfer={transfer}
          epoch={epoch}
          steps={steps}
          last={index === transfers.data!.length - 1}
          onSettled={settle}
          visible={privateReady}
          guard={recordGuard}
          onHeldChange={onHeldChange}
        />
      ))}
    </View>
  );
}
