import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_CORRECTION_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CorrectionRecord } from './CorrectionRecord';
import { useCompanyStyles } from './styles';
import { entriesKey, useRegisterCorrections } from './useCompanyRegister';

export function ClassCorrections({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const name = register.token.name;
  const corrections = useRegisterCorrections(epoch, company, register.token.uuid);
  const settle = () =>
    Promise.all([
      corrections.refetch(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' }),
      refreshHolders(),
      refreshAppointments(),
    ]);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.TITLE}
      </Text>
      <Text style={styles.muted}>{COPY.COMPENSATION_NOTE}</Text>
      {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {corrections.isPending ? (
        <Text style={styles.muted}>Loading corrections…</Text>
      ) : corrections.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The corrections could not be loaded.
          </Text>
          <Action
            label="Retry corrections"
            accessibilityLabel={`Retry corrections for ${name}`}
            disabled={corrections.isFetching}
            onPress={() => void corrections.refetch()}
          />
        </View>
      ) : corrections.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : (
        corrections.data.map(({ proposal, corrected }, index) => (
          <CorrectionRecord
            key={proposal.uuid}
            proposal={proposal}
            corrected={corrected}
            epoch={epoch}
            steps={steps}
            last={index === corrections.data.length - 1}
            onSettled={settle}
          />
        ))
      )}
    </View>
  );
}
