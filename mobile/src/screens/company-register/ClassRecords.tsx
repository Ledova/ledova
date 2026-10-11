import { useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import type { CompanyRegisterSection } from './CompanyRegisterScreen';
import {
  appointmentForAcknowledgement,
  hasCurrentRegisterReadAuthority,
  type OwnCompanyAppointment,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { ClassCorrections } from './ClassCorrections';
import { ClassEntries } from './ClassEntries';
import { ClassImports } from './ClassImports';
import { ClassGrants } from './ClassGrants';
import { ClassAllotments } from './ClassAllotments';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from './ClassRegister';
import { useCompanyStyles } from './styles';
import { assertSessionEpoch } from '../../services/sessionScope';
import { registerAppointmentsKey, useRegisterAppointments } from './useCompanyRegister';

const ON_CHAIN = ['deployed', 'paused'];

export function ClassRecords({
  epoch,
  company,
  register,
  refreshHolders,
  onOpen,
  onPrepareImport,
  onPrepareGrant,
  onPrepareAwardGrant,
  sourceReady = true,
  onPrepareTransfer,
  onCorrect,
  onChangeParticulars,
  section = 'register',
  onHeldChange,
}: {
  section?: CompanyRegisterSection;
  onHeldChange?: (key: string, held: boolean) => void;
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  refreshHolders: () => Promise<unknown>;
  onOpen: () => void;
  onPrepareImport: () => void;
  onPrepareGrant: () => void;
  onPrepareAwardGrant: (award: string) => void;
  sourceReady?: boolean;
  onPrepareTransfer: () => void;
  onCorrect: (entry: RegisterEntry) => void;
  onChangeParticulars: (member: string) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const currentSource = useRef(sourceReady);
  useLayoutEffect(() => {
    currentSource.current = sourceReady;
  }, [sourceReady]);
  const guard = () => {
    assertSessionEpoch(epoch);
    const state = client.getQueryState(registerAppointmentsKey(epoch));
    if (
      !currentSource.current ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(
        client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
        company,
      )
    )
      throw new Error('Refresh your company register and current appointments.');
  };
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const readReady =
    sourceReady &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const acknowledging = appointments.isSuccess ? appointmentForAcknowledgement(appointments.data, company) : undefined;
  return (
    <>
      <View style={section === 'register' ? undefined : { display: 'none' }}>
        {readReady && (
          <ClassRegister register={register} onChangeParticulars={steps?.prepare ? onChangeParticulars : undefined} />
        )}
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
            sourceReady={readReady}
            guard={guard}
            onHeldChange={onHeldChange}
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
          sourceReady={readReady}
          guard={guard}
          onHeldChange={onHeldChange}
        />
      </View>
      <View style={section === 'documents' ? undefined : { display: 'none' }}>
        {sourceReady && (
          <ClassEntries
            epoch={epoch}
            company={company}
            register={register}
            steps={steps}
            onCorrect={onCorrect}
            sourceReady={sourceReady && appointments.isSuccess && !appointments.isFetching}
          />
        )}
      </View>
      <View style={section === 'awards' ? undefined : { display: 'none' }}>
        <ClassGrants
          epoch={epoch}
          company={company}
          register={register}
          steps={steps}
          refreshHolders={refreshHolders}
          refreshAppointments={appointments.refetch}
          onPrepare={onPrepareGrant}
          sourceReady={sourceReady}
          onHeldChange={onHeldChange}
        />
        <ClassAwards
          key={`awards/${epoch}/${company}/${register.token.uuid}`}
          company={company}
          register={register}
          epoch={epoch}
          sourceReady={sourceReady}
          onPrepareGrant={onPrepareAwardGrant}
          onHeldChange={onHeldChange}
        />
      </View>
      <View style={section === 'register' ? undefined : { display: 'none' }}>
        <ClassAllotments
          key={`allotments/${epoch}/${company}/${register.token.uuid}`}
          company={company}
          register={register}
          epoch={epoch}
          sourceReady={sourceReady}
          onHeldChange={onHeldChange}
        />
        <ClassCorrections
          epoch={epoch}
          company={company}
          register={register}
          steps={steps}
          refreshHolders={refreshHolders}
          refreshAppointments={appointments.refetch}
          sourceReady={readReady}
          guard={guard}
          onHeldChange={onHeldChange}
        />
        <ClassTransfers
          epoch={epoch}
          company={company}
          register={register}
          steps={steps}
          refreshHolders={refreshHolders}
          refreshAppointments={appointments.refetch}
          onPrepare={onPrepareTransfer}
          sourceReady={readReady}
          guard={guard}
          onHeldChange={onHeldChange}
        />
        <ClassReconciliation
          epoch={epoch}
          register={register}
          appointment={acknowledging?.uuid}
          readOnly={appointments.isSuccess && !acknowledging}
          refreshAppointments={appointments.refetch}
          sourceReady={readReady}
          guard={guard}
        />
      </View>
    </>
  );
}
