import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_GRANT_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { GrantRecord } from './GrantRecord';
import { useCompanyStyles } from './styles';
import { entriesKey, useRegisterGrants } from './useCompanyRegister';

export function ClassGrants({
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
  const grants = useRegisterGrants(epoch, company, register.token.uuid);
  const settle = () =>
    Promise.all([
      grants.refetch(),
      refreshHolders(),
      refreshAppointments(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' }),
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
      {grants.isPending ? (
        <Text style={styles.muted}>Loading non-paid grants…</Text>
      ) : grants.isError ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            The grants could not be loaded.
          </Text>
          <Action label="Retry grants" disabled={grants.isFetching} onPress={() => void grants.refetch()} />
        </>
      ) : grants.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : (
        <>
          <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>
          <Action label="Refresh grants" disabled={grants.isFetching} onPress={() => void settle()} />
          {grants.data.map((grant, index) => (
            <GrantRecord
              key={grant.uuid}
              grant={grant}
              epoch={epoch}
              steps={steps}
              last={index === grants.data.length - 1}
              onSettled={settle}
            />
          ))}
        </>
      )}
    </View>
  );
}
