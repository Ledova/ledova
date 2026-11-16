import { useState } from 'react';
import { RefreshControl } from 'react-native';
import { usePreventRemove, type RouteProp } from '@react-navigation/native';
import {
  DESTINATIONS,
  appointmentForRegisterStep,
  useOwnAppointments,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { LoadError, Loading, Outcome } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ShareClasses } from './ShareClasses';

const TITLE = DESTINATIONS.companyRegister.title;
const LEDE = 'Share classes and current ownership.';

export function LedgerScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Ledger'> }) {
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
        outcome={route.params?.outcome}
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
  outcome,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  outcome?: string;
}) {
  const theme = useAppTheme();
  const source = useCompanyRegisters(owner, currentOwner, company, TITLE);
  const appointments = useOwnAppointments(owner, source.guard, { session: orderSubmissionSession });
  const [refreshing, setRefreshing] = useState(false);
  const [held, setHeld] = useState(false);
  usePreventRemove(held, () => {});
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
      held={held}
      refreshControl={
        <RefreshControl
          testID="ledger-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || held) return;
            setRefreshing(true);
            void Promise.all([source.retry(), appointments.refetch()]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {!!outcome && <Outcome>{outcome}</Outcome>}
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
      ) : null}
      <ShareClasses
        owner={owner}
        company={company}
        classes={source.classes.data ?? []}
        registers={registers}
        guard={source.guard}
        available={source.sourceReady}
        ready={source.ownershipReady && !source.accountError && !source.hasError && !source.invalid}
        canAdd={canAddClass}
        onHeldChange={setHeld}
      />
    </Page>
  );
}
