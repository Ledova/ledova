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
import { useCompanyStyles } from './styles';
import { entriesKey, transferMembersKey, useRegisterTransfers } from './useCompanyRegister';

export function ClassTransfers({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  onPrepare,
}: {
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
      {steps?.prepare && register.initialized && register.token.status === 'draft' && (
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
      ) : transfers.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : (
        <>
          <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>
          <Action label="Refresh transfers" disabled={transfers.isFetching} onPress={() => void settle()} />
          {transfers.data.map((transfer, index) => (
            <TransferRecord
              key={transfer.uuid}
              transfer={transfer}
              epoch={epoch}
              steps={steps}
              last={index === transfers.data.length - 1}
              onSettled={settle}
            />
          ))}
        </>
      )}
    </View>
  );
}
