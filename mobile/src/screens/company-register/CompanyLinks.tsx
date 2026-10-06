import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { REGISTER_LINK_COPY as COPY, type TokenHoldersResponse } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { LinkRecord } from './LinkRecord';
import { useCompanyStyles } from './styles';
import {
  entriesKey,
  useRegisterAppointments,
  useRegisterLinks,
  useRegisterWaitingWallets,
  waitingWalletsKey,
} from './useCompanyRegister';

export function CompanyLinks({
  epoch,
  company,
  registers,
  refreshHolders,
  onPrepare,
}: {
  epoch: number;
  company: string;
  registers: TokenHoldersResponse[];
  refreshHolders: () => Promise<unknown>;
  onPrepare: () => void;
}) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const links = useRegisterLinks(epoch, company);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const waiting = useRegisterWaitingWallets(epoch, company, !!steps?.prepare);
  const names = new Map(
    registers.flatMap(({ holders }) => holders.flatMap(({ member, name }) => (name ? [[member, name] as const] : []))),
  );
  const settle = () =>
    Promise.all([
      links.refetch(),
      queryClient.refetchQueries({ queryKey: waitingWalletsKey(epoch, company), type: 'active' }),
      refreshHolders(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch), type: 'active' }),
      appointments.refetch(),
    ]);
  return (
    <Section title={COPY.TITLE}>
      {appointments.isError && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Your appointments could not be read, so wallet link actions are hidden.
          </Text>
          <Action
            label="Retry appointments"
            accessibilityLabel="Retry appointments for wallet links"
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </View>
      )}
      {steps && !Object.values(steps).some(Boolean) && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {steps?.prepare &&
        (waiting.isError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              The waiting wallets could not be read.
            </Text>
            <Action
              label="Retry waiting wallets"
              disabled={waiting.isFetching}
              onPress={() => void waiting.refetch()}
            />
          </View>
        ) : (
          <View style={styles.group}>
            <Action label={COPY.PREPARE} disabled={!waiting.data?.length} onPress={onPrepare} />
            {waiting.data?.length === 0 && <Text style={styles.muted}>{COPY.NOTHING_WAITING}</Text>}
          </View>
        ))}
      {links.isPending ? (
        <Text style={styles.muted}>Loading wallet links…</Text>
      ) : links.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The wallet links could not be loaded.
          </Text>
          <Action label="Retry wallet links" disabled={links.isFetching} onPress={() => void links.refetch()} />
        </View>
      ) : links.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : (
        links.data.map((link, index) => (
          <LinkRecord
            key={link.uuid}
            link={link}
            names={names}
            epoch={epoch}
            steps={steps}
            last={index === links.data.length - 1}
            onSettled={settle}
          />
        ))
      )}
    </Section>
  );
}
