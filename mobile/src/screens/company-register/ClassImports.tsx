import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_IMPORT_COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { ImportRecord } from './ImportRecord';
import { useCompanyStyles } from './styles';
import { entriesKey, useRegisterImports } from './useCompanyRegister';

export function ClassImports({
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
  const name = register.token.name;
  const imports = useRegisterImports(epoch, company, register.token.uuid);
  const refreshEntries = () =>
    queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' });
  const settle = () => Promise.all([imports.refetch(), refreshEntries(), refreshHolders()]);
  const refused = () => Promise.all([imports.refetch(), refreshEntries(), refreshHolders(), refreshAppointments()]);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {REGISTER_IMPORT_COPY.TITLE}
      </Text>
      {steps && !Object.values(steps).some(Boolean) && (
        <Text style={styles.muted}>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</Text>
      )}
      {imports.isPending ? (
        <Text style={styles.muted}>Loading imports…</Text>
      ) : imports.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The imports could not be loaded.
          </Text>
          <Action
            label="Retry imports"
            accessibilityLabel={`Retry imports for ${name}`}
            disabled={imports.isFetching}
            onPress={() => void imports.refetch()}
          />
        </View>
      ) : (
        <>
          {steps?.prepare && !imports.data.some(({ status }) => status === 'applied') && (
            <Action
              label={REGISTER_IMPORT_COPY.PREPARE}
              accessibilityLabel={`${REGISTER_IMPORT_COPY.PREPARE} for ${name}`}
              onPress={onPrepare}
            />
          )}
          {imports.data.length === 0 ? (
            <Text style={styles.muted}>{REGISTER_IMPORT_COPY.EMPTY}</Text>
          ) : (
            imports.data.map((proposal, index) => (
              <ImportRecord
                key={proposal.uuid}
                proposal={proposal}
                epoch={epoch}
                steps={steps}
                last={index === imports.data.length - 1}
                onSettled={settle}
                onRefused={refused}
              />
            ))
          )}
        </>
      )}
    </View>
  );
}
