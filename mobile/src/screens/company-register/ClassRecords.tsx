import { Text, View } from 'react-native';
import { appointmentForAcknowledgement, type RegisterEntry, type TokenHoldersResponse } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { ClassCorrections } from './ClassCorrections';
import { ClassEntries } from './ClassEntries';
import { ClassImports } from './ClassImports';
import { ClassReconciliation } from './ClassReconciliation';
import { useCompanyStyles } from './styles';
import { useRegisterAppointments } from './useCompanyRegister';

export function ClassRecords({
  epoch,
  company,
  register,
  refreshHolders,
  onPrepareImport,
  onCorrect,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  refreshHolders: () => Promise<unknown>;
  onPrepareImport: () => void;
  onCorrect: (entry: RegisterEntry) => void;
}) {
  const styles = useCompanyStyles();
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const acknowledging = appointments.isSuccess ? appointmentForAcknowledgement(appointments.data, company) : undefined;
  return (
    <>
      {appointments.isError && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Your appointments could not be read, so register actions are hidden.
          </Text>
          <Action
            label="Retry appointments"
            accessibilityLabel={`Retry appointments for ${register.token.name}`}
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </View>
      )}
      <ClassImports
        epoch={epoch}
        company={company}
        register={register}
        steps={steps}
        refreshHolders={refreshHolders}
        refreshAppointments={appointments.refetch}
        onPrepare={onPrepareImport}
      />
      <ClassEntries epoch={epoch} register={register} steps={steps} onCorrect={onCorrect} />
      <ClassCorrections
        epoch={epoch}
        company={company}
        register={register}
        steps={steps}
        refreshHolders={refreshHolders}
        refreshAppointments={appointments.refetch}
      />
      <ClassReconciliation
        epoch={epoch}
        register={register}
        appointment={acknowledging?.uuid}
        readOnly={appointments.isSuccess && !acknowledging}
        refreshAppointments={appointments.refetch}
      />
    </>
  );
}
