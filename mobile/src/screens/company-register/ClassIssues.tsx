import { Text, View } from 'react-native';
import type { OwnCompanyAppointment, RegisterStep, TokenHoldersResponse } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';

export function ClassIssues({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  sourceReady,
  onHeldChange,
  onPrepareGrant,
  onSetUp,
  onOpenClass,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
  sourceReady: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
  onPrepareGrant: () => void;
  onSetUp: () => void;
  onOpenClass: () => void;
}) {
  const styles = useCompanyStyles();
  const investor = useInvestorIssues({ company, register, epoch, sourceReady, onHeldChange, onSetUp, onOpenClass });
  const nonPaid = useNonPaidIssues({
    epoch,
    company,
    register,
    steps,
    refreshHolders,
    refreshAppointments,
    onPrepare: onPrepareGrant,
    sourceReady,
    onHeldChange,
  });
  return (
    <>
      {investor.setup}
      <Section title="Share issues">
        {investor.status}
        {nonPaid.status}
        {investor.empty && nonPaid.empty && <Text style={styles.muted}>No share issues recorded yet.</Text>}
        {investor.records}
        {nonPaid.records}
        <Action
          label="Refresh share issues"
          disabled={!sourceReady || investor.refreshing || nonPaid.refreshing}
          onPress={() => void Promise.allSettled([investor.refresh(), nonPaid.refresh()])}
        />
      </Section>
      {(investor.prepare || nonPaid.prepare) && (
        <View style={styles.group}>
          {investor.prepare}
          {nonPaid.prepare}
        </View>
      )}
    </>
  );
}
