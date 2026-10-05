import { Text, View } from 'react-native';
import {
  REGISTER_CORRECTION_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CorrectionRecord } from './CorrectionRecord';
import { useCompanyStyles } from './styles';
import { useRegisterCorrections, useRegisterEntries } from './useCompanyRegister';

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
  const name = register.token.name;
  const entries = useRegisterEntries(epoch, register.token.uuid);
  const corrections = useRegisterCorrections(epoch, company);
  const recorded = new Map((entries.data ?? []).map((entry) => [entry.uuid, entry]));
  const listed = (corrections.data ?? []).filter(({ corrects }) => recorded.has(corrects));
  const settle = () => Promise.all([corrections.refetch(), entries.refetch(), refreshHolders(), refreshAppointments()]);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.TITLE}
      </Text>
      <Text style={styles.muted}>{COPY.COMPENSATION_NOTE}</Text>
      {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {corrections.isPending || entries.isPending ? (
        <Text style={styles.muted}>Loading corrections…</Text>
      ) : corrections.isError || entries.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The corrections could not be loaded.
          </Text>
          <Action
            label="Retry corrections"
            accessibilityLabel={`Retry corrections for ${name}`}
            disabled={corrections.isFetching || entries.isFetching}
            onPress={() => void Promise.all([corrections.refetch(), entries.refetch()])}
          />
        </View>
      ) : listed.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : (
        listed.map((proposal, index) => (
          <CorrectionRecord
            key={proposal.uuid}
            proposal={proposal}
            corrected={recorded.get(proposal.corrects)!}
            epoch={epoch}
            steps={steps}
            last={index === listed.length - 1}
            onSettled={settle}
          />
        ))
      )}
    </View>
  );
}
