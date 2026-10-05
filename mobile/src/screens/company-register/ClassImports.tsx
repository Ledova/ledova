import { Text, View } from 'react-native';
import { REGISTER_IMPORT_COPY, type TokenHoldersResponse } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { ImportRecord } from './ImportRecord';
import { useCompanyStyles } from './styles';
import { useImportAppointments, useRegisterImports } from './useCompanyRegister';

export function ClassImports({
  epoch,
  company,
  register,
  refreshHolders,
  onPrepare,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  refreshHolders: () => Promise<unknown>;
  onPrepare: () => void;
}) {
  const styles = useCompanyStyles();
  const name = register.token.name;
  const imports = useRegisterImports(epoch, company, register.token.uuid);
  const { appointments, steps } = useImportAppointments(epoch, company);
  const settle = () => Promise.all([imports.refetch(), refreshHolders()]);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {REGISTER_IMPORT_COPY.TITLE}
      </Text>
      {appointments.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Your appointments could not be read, so import actions are hidden.
          </Text>
          <Action
            label="Retry appointments"
            accessibilityLabel={`Retry appointments for ${name}`}
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </View>
      ) : (
        steps &&
        !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</Text>
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
                onStale={appointments.refetch}
              />
            ))
          )}
        </>
      )}
    </View>
  );
}
