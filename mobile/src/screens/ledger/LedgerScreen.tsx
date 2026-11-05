import { useState } from 'react';
import { RefreshControl, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  DESTINATIONS,
  appointmentForRegisterStep,
  classFacts,
  formatShareCount,
  useOwnAppointments,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Action, Actions, LinkRow, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useLedgerStyles } from './useLedgerStyles';

const TITLE = DESTINATIONS.companyRegister.title;
const LEDE = 'Share classes and current ownership.';

export function LedgerScreen() {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing)
    return (
      <CompanyLedger
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
      />
    );
  return (
    <Page testID="ledger-scroll" title={TITLE} lede={LEDE}>
      {!owner ? (
        <AccountCheck />
      ) : directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your company access could not be confirmed.
        </LoadError>
      ) : choosing ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <CompanyContextNotice />
      )}
    </Page>
  );
}

function CompanyLedger({
  owner,
  currentOwner,
  company,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
}) {
  const theme = useAppTheme();
  const look = useLedgerStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const source = useCompanyRegisters(owner, currentOwner, company, TITLE);
  const appointments = useOwnAppointments(owner, source.guard, { session: orderSubmissionSession });
  const [refreshing, setRefreshing] = useState(false);
  const registers = source.ownershipReady ? (source.registers ?? []) : [];
  const canAddClass =
    source.sourceReady &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  return (
    <Page
      testID="ledger-scroll"
      title={TITLE}
      lede={LEDE}
      refreshControl={
        <RefreshControl
          testID="ledger-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing) return;
            setRefreshing(true);
            void Promise.all([source.retry(), appointments.refetch()]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {source.accountError ? (
        <LoadError retry={source.retryAccount} busy={source.isRefreshing}>
          Your account could not be loaded.
        </LoadError>
      ) : source.hasError || source.invalid ? (
        <LoadError retry={source.retry} busy={source.isRefreshing}>
          The register could not be loaded.
        </LoadError>
      ) : !source.ownershipReady ? (
        <Loading>Loading the register…</Loading>
      ) : registers.length === 0 ? (
        <Section title="Share classes">
          <Text style={look.muted}>No share classes yet.</Text>
        </Section>
      ) : (
        <Section title="Share classes">
          <Rows>
            {registers.map((register) => {
              const issued = register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply);
              const facts = classFacts(register);
              return (
                <LinkRow
                  key={register.token.uuid}
                  label={register.token.name}
                  accessibilityLabel={`${register.token.name}, ${register.issuedSupply === null ? 'issued shares not recorded' : `${issued} issued shares`}, ${facts}`}
                  figure={issued}
                  onPress={() => navigation.navigate('ShareClass', { company, token: register.token.uuid })}
                >
                  <Text style={look.small}>{facts}</Text>
                </LinkRow>
              );
            })}
          </Rows>
        </Section>
      )}
      {canAddClass && (
        <Actions>
          <Action primary label="Add share class" onPress={() => navigation.navigate('RegisterSetup', { company })} />
        </Actions>
      )}
    </Page>
  );
}
