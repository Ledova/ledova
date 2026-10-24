import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  formatDate,
  formatDateTime,
  shareCount,
  type RegisterDecisionKind,
  type RegisterProposal,
} from '@ledova/shared';
import { Row, type Tone } from '../../components/Ledger';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export const ISSUE_TONES: Record<string, Tone> = {
  submitted: 'waiting',
  approved: 'waiting',
  applied: 'done',
  rejected: 'closed',
};

export function decisionRows(proposal: RegisterProposal, labels: Record<RegisterDecisionKind, string>) {
  return (
    <>
      {[...proposal.decisions]
        .sort((left, right) => Date.parse(left.decidedAt) - Date.parse(right.decidedAt))
        .map((item) => (
          <Row key={item.uuid} label={labels[item.kind]}>
            {item.decidedByName || 'Not provided'} · {formatDateTime(item.decidedAt)}
            {item.reason ? ` · ${item.reason}` : ''}
          </Row>
        ))}
      {proposal.decisions.length === 0 && !!proposal.reviewedAt && (
        <Row label="Decided on">{formatDateTime(proposal.reviewedAt)}</Row>
      )}
      {proposal.status === 'rejected' && !!proposal.rejectionReason && (
        <Row label="Rejection reason">{proposal.rejectionReason}</Row>
      )}
    </>
  );
}

function useSummaryGrid() {
  return useThemedStyles((theme) => ({
    grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, rowGap: theme.spacing.md },
    cell: { width: '50%' as const, gap: theme.spacing.xs, paddingRight: theme.spacing.sm },
  }));
}

export function RecordSummary({ children }: { children: ReactNode }) {
  return <View style={useSummaryGrid().grid}>{children}</View>;
}

export function SummaryCell({ label, children }: { label: string; children: ReactNode }) {
  const styles = useCompanyStyles();
  return (
    <View style={useSummaryGrid().cell}>
      <Text style={styles.muted}>{label}</Text>
      {children}
    </View>
  );
}

export function IssueSummary({
  name,
  kind,
  shares,
  amount,
  companyEventOn,
  status,
}: {
  name: string;
  kind: string;
  shares: string;
  amount?: string;
  companyEventOn?: string | null;
  status: ReactNode;
}) {
  const styles = useCompanyStyles();
  return (
    <RecordSummary>
      <SummaryCell label="Recipient">
        <Text accessibilityRole="header" style={styles.heading}>
          {name}
        </Text>
        <Text style={styles.muted}>{kind}</Text>
      </SummaryCell>
      <SummaryCell label="Shares">
        <Text style={styles.text}>{shareCount(shares)}</Text>
        {!!amount && <Text style={styles.muted}>{amount}</Text>}
      </SummaryCell>
      <SummaryCell label="Company issue date">
        <Text style={styles.text}>{formatDate(companyEventOn, 'Not recorded')}</Text>
      </SummaryCell>
      <SummaryCell label="Status">{status}</SummaryCell>
    </RecordSummary>
  );
}
