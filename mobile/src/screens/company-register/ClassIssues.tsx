import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_GRANT_COPY as GRANT_COPY,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';

const HIDDEN = { display: 'none' } as const;

export interface IssueRequest {
  key: string;
  award?: string;
}

export function ClassIssues({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  sourceReady,
  onHeldChange,
  onSetUp,
  onOpenClass,
  request,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
  sourceReady: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
  onSetUp: () => void;
  onOpenClass: () => void;
  request?: IssueRequest;
}) {
  const styles = useCompanyStyles();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [award, setAward] = useState<string | undefined>();
  const [answered, setAnswered] = useState('');
  const onReviewChange = useCallback(
    (uuid: string, open: boolean) => setReviewing((current) => (open ? uuid : current === uuid ? null : current)),
    [],
  );
  const close = () => {
    setPreparing(false);
    setAward(undefined);
  };
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
    sourceReady,
    onHeldChange,
    award,
    open: preparing,
    kept: preparing,
    onClosed: close,
    reviewing,
    onReviewChange,
  });
  const held = investor.held || nonPaid.held;
  if (request && answered !== request.key && !held) {
    setAnswered(request.key);
    if (request.award) {
      setPreparing(true);
      setAward(request.award);
    }
  }
  const browsing = !preparing && !reviewing;
  return (
    <>
      {investor.setup}
      <View style={preparing ? HIDDEN : undefined}>
        <Section title={reviewing ? 'Review share issue' : 'Share issues'}>
          {investor.status}
          {nonPaid.status}
          {browsing && investor.empty && nonPaid.empty && (
            <Text style={styles.muted}>No share issues recorded yet.</Text>
          )}
          {investor.records}
          {nonPaid.records}
          {browsing && (
            <Action
              label="Refresh share issues"
              disabled={!sourceReady || investor.refreshing || nonPaid.refreshing}
              onPress={() => void Promise.allSettled([investor.refresh(), nonPaid.refresh()])}
            />
          )}
        </Section>
      </View>
      {(investor.prepare || nonPaid.prepare) && (
        <View style={browsing ? styles.group : HIDDEN}>
          {investor.prepare}
          {nonPaid.prepare && (
            <Action
              label={GRANT_COPY.PREPARE}
              accessibilityLabel={`${GRANT_COPY.PREPARE} for ${register.token.name}`}
              disabled={held || !sourceReady}
              onPress={() => setPreparing(true)}
            />
          )}
        </View>
      )}
      <View style={preparing ? undefined : HIDDEN}>
        <Section title="Prepare share issue">
          {preparing && investor.status}
          {preparing && nonPaid.status}
          {nonPaid.form}
        </Section>
      </View>
    </>
  );
}
