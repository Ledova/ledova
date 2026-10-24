import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { StackActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import { peopleFrom, REGISTER_TRANSFER_COPY as COPY } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useClassRegister, useTransferMembers, useRegisterAppointments } from '../../hooks/useCompanyRegister';
import { TransferForm } from './TransferForm';

export function PrepareRegisterTransferScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterTransfer key={epoch} epoch={epoch} />;
}

function PrepareRegisterTransfer({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid, fromMember } =
    useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterTransfer'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const members = useTransferMembers(epoch, tokenUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const latest = useRef(steps?.prepare);
  useLayoutEffect(() => {
    latest.current = steps?.prepare;
  }, [steps?.prepare]);
  const fetching = register.isFetching || members.isFetching || appointments.isFetching;
  const stale = register.isError || members.isError || appointments.isError;
  const refresh = () => Promise.all([register.refetch(), members.refetch(), appointments.refetch()]);
  const toTransfers = () =>
    navigation.dispatch(
      StackActions.popTo('CompanyMain', { section: 'transfer', companyUuid, tokenUuid, select: Crypto.randomUUID() }),
    );
  const failure = (
    <>
      <Text accessibilityRole="alert" style={styles.error}>
        The register or your appointments could not be loaded.
      </Text>
      <Action label="Retry" disabled={fetching} onPress={() => void refresh()} />
    </>
  );
  const title = 'Transfer shares';
  if (!register.data || !members.data || !appointments.data)
    return <Page title={title}>{stale ? failure : <Text style={styles.muted}>Loading the register…</Text>}</Page>;
  const appointment = steps?.prepare;
  if (!appointment)
    return (
      <Page title={title}>
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  const { token } = register.data;
  if (!register.data.initialized || token.status !== 'draft')
    return (
      <Page title={title}>
        <Text style={styles.muted}>
          This transfer requires an opened register for a draft share class without a deployed contract.
        </Text>
      </Page>
    );
  return (
    <Page
      testID="prepare-transfer-screen"
      title={title}
      lede={`${appointment.companyName} · ${token.name} (${token.symbol})`}
    >
      <Section title="Non-paid transfer">
        {stale && failure}
        <TransferForm
          company={companyUuid}
          token={tokenUuid}
          epoch={epoch}
          classLabel={`${token.name} (${token.symbol})`}
          people={peopleFrom(members.data)}
          appointment={appointment}
          current={() => latest.current}
          blocked={stale || fetching}
          initialFrom={fromMember}
          onRefused={refresh}
          onPrepared={toTransfers}
          onCancel={toTransfers}
        />
      </Section>
    </Page>
  );
}
