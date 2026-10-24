import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_TRANSFER_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, LinkRow, Section } from '../../components/Ledger';
import { TransferRecord } from './TransferRecord';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { entriesKey, transfersKey, transferMembersKey, useRegisterTransfers } from '../../hooks/useCompanyRegister';

export function ClassTransfers({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  onPrepare,
  onSetUp,
  onOpenClass,
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
  onPrepare: () => void;
  onSetUp: () => void;
  onOpenClass: () => void;
}) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const onReviewChange = useCallback(
    (uuid: string, open: boolean) => setReviewing((current) => (open ? uuid : current === uuid ? null : current)),
    [],
  );
  const transfers = useRegisterTransfers(epoch, company, register.token.uuid);
  const privateReady = sourceReady && transfers.isSuccess && !transfers.isFetching;
  const draft = register.token.status === 'draft';
  const supported = register.initialized && draft;
  const recordGuard = () => {
    guard?.();
    const state = queryClient.getQueryState(transfersKey(epoch, register.token.uuid));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the register records before continuing.');
  };
  const settle = () =>
    Promise.all([
      transfers.refetch(),
      refreshHolders(),
      refreshAppointments(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, register.token.uuid), type: 'active' }),
      queryClient.invalidateQueries({ queryKey: transferMembersKey(epoch, register.token.uuid) }),
    ]);
  const records = transfers.data ?? [];
  return (
    <>
      <Section title={reviewing ? 'Review share transfer' : 'Share transfers'}>
        {!supported && (
          <View style={styles.group}>
            {sourceReady && (
              <Text style={styles.muted}>
                {draft
                  ? 'Set up this share register before recording a transfer.'
                  : 'Tokenised share transfers use wallet and chain controls. This task records non-paid transfers for a non-tokenised register.'}
              </Text>
            )}
            {privateReady && !!steps?.prepare && (
              <LinkRow
                label={draft ? DESTINATIONS.companyRegisterImport.title : DESTINATIONS.companyClass.title}
                onPress={draft ? onSetUp : onOpenClass}
              />
            )}
          </View>
        )}
        {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
        {transfers.isPending ? (
          <Text style={styles.muted}>Loading non-paid transfers…</Text>
        ) : transfers.isError ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              The transfers could not be loaded.
            </Text>
            <Action label="Retry transfers" disabled={transfers.isFetching} onPress={() => void transfers.refetch()} />
          </>
        ) : privateReady && records.length === 0 ? (
          <Text style={styles.muted}>{COPY.EMPTY}</Text>
        ) : null}
        {!reviewing && (
          <Action label="Refresh transfers" disabled={transfers.isFetching} onPress={() => void settle()} />
        )}
        {records.map((transfer, index) => (
          <TransferRecord
            key={transfer.uuid}
            transfer={transfer}
            epoch={epoch}
            steps={steps ?? {}}
            last={index === records.length - 1}
            onSettled={settle}
            visible={privateReady && (!reviewing || reviewing === transfer.uuid)}
            guard={recordGuard}
            onHeldChange={onHeldChange}
            onReviewChange={onReviewChange}
          />
        ))}
      </Section>
      {!reviewing && privateReady && !!steps?.prepare && supported && (
        <View style={styles.actions}>
          <Action
            label={COPY.PREPARE}
            accessibilityLabel={`${COPY.PREPARE} for ${register.token.name}`}
            primary
            onPress={onPrepare}
          />
        </View>
      )}
    </>
  );
}
