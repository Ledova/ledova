import { useCallback, useLayoutEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
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
import { Action, Section } from '../../components/Ledger';
import { ClassCorrections } from './ClassCorrections';
import { ClassEntries } from './ClassEntries';
import { ClassImports } from './ClassImports';
import { ClassIssues, type IssueRequest } from './ClassIssues';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { assertSessionEpoch } from '../../services/sessionScope';
import { registerAppointmentsKey, useRegisterAppointments } from '../../hooks/useCompanyRegister';

const ON_CHAIN = ['deployed', 'paused'];
const HIDDEN = { display: 'none' } as const;

export function ClassRecords({
  epoch,
  company,
  register,
  refreshHolders,
  onOpen,
  onPrepareImport,
  onPrepareAwardGrant,
  issueRequest,
  onOpenClass,
  sourceReady = true,
  onPrepareTransfer,
  onCorrect,
  section,
  selected,
  onHeldChange,
}: {
  section: CompanyRegisterSection;
  selected: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  refreshHolders: () => Promise<unknown>;
  onOpen: () => void;
  onPrepareImport: (correctionOf?: string) => void;
  onPrepareAwardGrant: (award: string) => void;
  issueRequest?: IssueRequest;
  onOpenClass: () => void;
  sourceReady?: boolean;
  onPrepareTransfer: () => void;
  onCorrect: (entry: RegisterEntry) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const focused = useIsFocused();
  const currentSource = useRef(sourceReady);
  useLayoutEffect(() => {
    currentSource.current = sourceReady;
  }, [sourceReady]);
  const token = register.token.uuid;
  const transferHeld = useCallback(
    (key: string, held: boolean) => onHeldChange?.(`transfer/${token}/${key}`, held),
    [onHeldChange, token],
  );
  const correctionHeld = useCallback(
    (key: string, held: boolean) => onHeldChange?.(`corrections/${token}/${key}`, held),
    [onHeldChange, token],
  );
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
  const shown = (part: CompanyRegisterSection) => section === part && (part === 'awards' || selected);
  const appointmentFailure = appointments.isError && (
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
  );
  return (
    <>
      <View style={shown('issue') ? styles.group : HIDDEN}>
        {appointmentFailure}
        <ClassIssues
          key={`issues/${epoch}/${company}/${token}`}
          epoch={epoch}
          company={company}
          register={register}
          steps={steps}
          refreshHolders={refreshHolders}
          refreshAppointments={appointments.refetch}
          sourceReady={sourceReady}
          onHeldChange={onHeldChange}
          onSetUp={() => onPrepareImport()}
          onOpenClass={onOpenClass}
          request={issueRequest}
          visible={shown('issue') && focused}
        />
      </View>
      <View style={shown('transfer') ? styles.group : HIDDEN}>
        {appointmentFailure}
        <ClassTransfers
          epoch={epoch}
          company={company}
          register={register}
          steps={steps}
          refreshHolders={refreshHolders}
          refreshAppointments={appointments.refetch}
          onPrepare={onPrepareTransfer}
          onSetUp={() => onPrepareImport()}
          onOpenClass={onOpenClass}
          sourceReady={readReady}
          guard={guard}
          onHeldChange={transferHeld}
        />
      </View>
      <View style={shown('history') ? undefined : HIDDEN}>
        <Section title={register.token.name}>
          {appointmentFailure}
          {sourceReady && <ClassEntries epoch={epoch} register={register} steps={steps} onCorrect={onCorrect} />}
        </Section>
      </View>
      <View style={shown('corrections') ? undefined : HIDDEN}>
        <Section title={register.token.name}>
          {appointmentFailure}
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
              onHeldChange={correctionHeld}
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
            onHeldChange={correctionHeld}
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
            onHeldChange={correctionHeld}
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
        </Section>
      </View>
      <View style={shown('awards') ? undefined : HIDDEN}>
        <Section title={register.token.name}>
          <ClassAwards
            key={`awards/${epoch}/${company}/${token}`}
            company={company}
            register={register}
            epoch={epoch}
            sourceReady={sourceReady}
            onPrepareGrant={onPrepareAwardGrant}
            onHeldChange={onHeldChange}
          />
        </Section>
      </View>
    </>
  );
}
