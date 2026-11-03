import { useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  DESTINATIONS,
  REGISTER_COPY,
  TECHNICAL_SHARE_LIMIT,
  formatShareCount,
  useSubmissionOwner,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { LinkRow, LoadError, Loading, Rows, Section, Status } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ClassFigures } from './ClassFigures';
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
  const [refreshing, setRefreshing] = useState(false);
  const registers = source.ownershipReady ? (source.registers ?? []) : [];
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
            void source.retry().finally(() => setRefreshing(false));
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
        registers.map((register) => (
          <Section key={register.token.uuid} title={`${register.token.name} · ${register.token.symbol}`}>
            <ClassRegister register={register} />
            <Rows>
              <LinkRow
                label="Class details"
                accessibilityLabel={`Class details (${register.token.name})`}
                onPress={() => navigation.navigate('ShareClass', { company, token: register.token.uuid })}
              />
            </Rows>
          </Section>
        ))
      )}
    </Page>
  );
}

function ClassRegister({ register }: { register: TokenHoldersResponse }) {
  const look = useLedgerStyles();
  return (
    <>
      <View style={look.summary}>
        <ClassFigures
          label={`${register.token.name} share summary`}
          issued={register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
          holders={register.initialized ? String(register.totalHolders) : 'Not recorded'}
        />
        {!register.initialized && (
          <Status tone="waiting" muted>
            Ledger not opened
          </Status>
        )}
      </View>
      {register.token.totalSupply !== TECHNICAL_SHARE_LIMIT && (
        <Text style={look.muted}>
          Authorised shares · <Text style={look.strong}>{formatShareCount(register.token.totalSupply)}</Text>
        </Text>
      )}
      {!register.initialized ? (
        <Text style={look.muted}>{REGISTER_COPY.NOT_OPENED_NOTE}</Text>
      ) : (
        <>
          {register.waitingEffects === null ? (
            <Text accessibilityLiveRegion="polite" style={look.muted}>
              {REGISTER_COPY.WAITING_UNKNOWN_NOTE}
            </Text>
          ) : register.waitingEffects > 0 ? (
            <Text accessibilityLiveRegion="polite" style={look.muted}>
              {REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}
            </Text>
          ) : null}
          {register.holders.length === 0 && <Text style={look.muted}>No current members yet.</Text>}
        </>
      )}
    </>
  );
}
