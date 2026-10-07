import { Text, View } from 'react-native';
import { appointmentForAcknowledgement, type RegisterEntry, type TokenHoldersResponse } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { ClassCorrections } from './ClassCorrections';
import { ClassEntries } from './ClassEntries';
import { ClassImports } from './ClassImports';
import { ClassGrants } from './ClassGrants';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from './ClassRegister';
import { useCompanyStyles } from './styles';
import { useRegisterAppointments } from './useCompanyRegister';

const ON_CHAIN = ['deployed', 'paused'];

export function ClassRecords({
  epoch,
  company,
  register,
  refreshHolders,
  onOpen,
  onPrepareImport,
  onPrepareGrant,
  onPrepareTransfer,
  onCorrect,
  onChangeParticulars,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  refreshHolders: () => Promise<unknown>;
  onOpen: () => void;
  onPrepareImport: () => void;
  onPrepareGrant: () => void;
  onPrepareTransfer: () => void;
  onCorrect: (entry: RegisterEntry) => void;
  onChangeParticulars: (member: string) => void;
}) {
  const styles = useCompanyStyles();
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const acknowledging = appointments.isSuccess ? appointmentForAcknowledgement(appointments.data, company) : undefined;
  return (
    <>
      <ClassRegister register={register} onChangeParticulars={steps?.prepare ? onChangeParticulars : undefined} />
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
      {ON_CHAIN.includes(register.token.status) && (
        <ClassOpenings
          epoch={epoch}
          company={company}
          register={register}
          steps={steps}
          refreshHolders={refreshHolders}
          refreshAppointments={appointments.refetch}
          onOpen={onOpen}
        />
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
      <ClassGrants
        epoch={epoch}
        company={company}
        register={register}
        steps={steps}
        refreshHolders={refreshHolders}
        refreshAppointments={appointments.refetch}
        onPrepare={onPrepareGrant}
      />
      <ClassCorrections
        epoch={epoch}
        company={company}
        register={register}
        steps={steps}
        refreshHolders={refreshHolders}
        refreshAppointments={appointments.refetch}
      />
      <ClassTransfers
        epoch={epoch}
        company={company}
        register={register}
        steps={steps}
        refreshHolders={refreshHolders}
        refreshAppointments={appointments.refetch}
        onPrepare={onPrepareTransfer}
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
