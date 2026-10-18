import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_OPENING_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { OpeningRecord } from './OpeningRecord';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { entriesKey, openingsKey, useRegisterOpenings } from '../../hooks/useCompanyRegister';

export function ClassOpenings({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  onOpen,
  sourceReady = true,
  guard,
  onHeldChange,
}: {
  sourceReady?: boolean;
  guard?: () => void;
  onHeldChange?: (key: string, held: boolean) => void;
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
  onOpen: () => void;
}) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const name = register.token.name;
  const openings = useRegisterOpenings(epoch, company, register.token.uuid);
  const privateReady = sourceReady && openings.isSuccess && !openings.isFetching;
  const recordGuard = () => {
    guard?.();
    const state = queryClient.getQueryState(openingsKey(epoch, register.token.uuid));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the register records before continuing.');
  };
  const settle = () =>
    Promise.all([
      openings.refetch(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' }),
      refreshHolders(),
      refreshAppointments(),
    ]);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.TITLE}
      </Text>
      <Text style={styles.muted}>{COPY.BOUNDARY_NOTE}</Text>
      {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {openings.isPending ? (
        <Text style={styles.muted}>Loading openings…</Text>
      ) : openings.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The openings could not be loaded.
          </Text>
          <Action
            label="Retry openings"
            accessibilityLabel={`Retry openings for ${name}`}
            disabled={openings.isFetching}
            onPress={() => void openings.refetch()}
          />
        </View>
      ) : (
        <>
          {privateReady && steps?.prepare && !register.initialized && (
            <Action label={COPY.PREPARE} accessibilityLabel={`${COPY.PREPARE} for ${name}`} onPress={onOpen} />
          )}
          {privateReady && openings.data.length === 0 && <Text style={styles.muted}>{COPY.EMPTY}</Text>}
        </>
      )}
      {openings.data?.map((proposal, index) => (
        <OpeningRecord
          key={proposal.uuid}
          proposal={proposal}
          epoch={epoch}
          steps={steps}
          last={index === openings.data!.length - 1}
          onSettled={settle}
          visible={privateReady}
          guard={recordGuard}
          onHeldChange={onHeldChange}
        />
      ))}
    </View>
  );
}
