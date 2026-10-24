import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import type { OwnCompanyAppointment, RegisterStep, TokenHoldersResponse } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';

const HIDDEN = { display: 'none' } as const;

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
  const [reviewing, setReviewing] = useState<string | null>(null);
  const onReviewChange = useCallback(
    (uuid: string, open: boolean) => setReviewing((current) => (open ? uuid : current === uuid ? null : current)),
    [],
  );
  const investor = useInvestorIssues({
    company,
    register,
    epoch,
    sourceReady,
    onHeldChange,
    onSetUp,
    onOpenClass,
    reviewing,
    onReviewChange,
  });
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
    reviewing,
    onReviewChange,
  });
  return (
    <>
      {investor.setup}
      <Section title={reviewing ? 'Review share issue' : 'Share issues'}>
        {investor.status}
        {nonPaid.status}
        {!reviewing && investor.empty && nonPaid.empty && (
          <Text style={styles.muted}>No share issues recorded yet.</Text>
        )}
        {investor.records}
        {nonPaid.records}
        {!reviewing && (
          <Action
            label="Refresh share issues"
            disabled={!sourceReady || investor.refreshing || nonPaid.refreshing}
            onPress={() => void Promise.allSettled([investor.refresh(), nonPaid.refresh()])}
          />
        )}
      </Section>
      {(investor.prepare || nonPaid.prepare) && (
        <View style={reviewing ? HIDDEN : styles.group}>
          {investor.prepare}
          {nonPaid.prepare}
        </View>
      )}
    </>
  );
}
