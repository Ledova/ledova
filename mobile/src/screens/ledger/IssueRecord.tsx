import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  REGISTER_COPY,
  apiErrorSentence,
  formatDate,
  formatDateTime,
  shareCount,
  type RegisterDecisionKind,
  type RegisterProposal,
} from '@ledova/shared';
import { Action, Fact, Status, type Tone } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useLedgerStyles } from './useLedgerStyles';

export type IssueStatus = { tone: Tone; label: string; note?: string };

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
  status: IssueStatus;
}) {
  const look = useLedgerStyles();
  const count = shareCount(shares);
  const date = formatDate(companyEventOn, 'Not recorded');
  const cell = (label: string, values: (string | undefined)[], children: ReactNode) => (
    <View accessible accessibilityLabel={`${label}: ${values.filter(Boolean).join(', ')}`} style={look.cell}>
      <Text style={look.muted}>{label}</Text>
      {children}
    </View>
  );
  return (
    <View style={look.cells}>
      <View style={look.pair}>
        {cell(
          'Recipient',
          [name, kind],
          <>
            <Text style={look.name}>{name}</Text>
            <Text style={look.muted}>{kind}</Text>
          </>,
        )}
        {cell(
          'Shares',
          [count, amount],
          <>
            <Text style={look.title}>{count}</Text>
            {!!amount && <Text style={look.muted}>{amount}</Text>}
          </>,
        )}
      </View>
      <View style={look.pair}>
        {cell('Company issue date', [date], <Text style={look.title}>{date}</Text>)}
        {cell(
          'Status',
          [status.label, status.note],
          <>
            <Status tone={status.tone}>{status.label}</Status>
            {!!status.note && <Text style={look.muted}>{status.note}</Text>}
          </>,
        )}
      </View>
    </View>
  );
}

export function RecordShell({
  hidden,
  ruled,
  focusKey,
  onFocus,
  children,
}: {
  hidden: boolean;
  ruled: boolean;
  focusKey?: string;
  onFocus?: (record: View) => void;
  children: ReactNode;
}) {
  const look = useLedgerStyles();
  const item = useRef<View>(null);
  const focused = useRef('');
  useEffect(() => {
    if (!focusKey || hidden || focused.current === focusKey || !item.current) return;
    focused.current = focusKey;
    onFocus?.(item.current);
  }, [focusKey, hidden, onFocus]);
  return (
    <View ref={item} style={[look.record, ruled && look.ruled, hidden && look.hidden]}>
      {children}
    </View>
  );
}

export function decisionTrail(
  proposal: RegisterProposal,
  labels: Record<RegisterDecisionKind, string>,
): ReactElement[] {
  return [
    ...[...proposal.decisions]
      .sort((left, right) => Date.parse(left.decidedAt) - Date.parse(right.decidedAt))
      .map((item) => (
        <Fact key={item.uuid} label={labels[item.kind]}>
          {`${item.decidedByName || 'Not provided'} · ${formatDateTime(item.decidedAt)}${item.reason ? ` · ${item.reason}` : ''}`}
        </Fact>
      )),
    ...(proposal.decisions.length === 0 && proposal.reviewedAt
      ? [
          <Fact key="decided" label="Decided on">
            {formatDateTime(proposal.reviewedAt)}
          </Fact>,
        ]
      : []),
    ...(proposal.status === 'rejected' && proposal.rejectionReason
      ? [
          <Fact key="rejection" label="Rejection reason">
            {proposal.rejectionReason}
          </Fact>,
        ]
      : []),
  ];
}

export function DocumentActions<Kind extends string>({
  kinds,
  context,
  download,
}: {
  kinds: readonly Kind[];
  context: string;
  download: UseMutationResult<void, Error, Kind>;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  return (
    <>
      <View style={look.wrap}>
        {kinds.map((kind) => {
          const label =
            download.isPending && download.variables === kind ? 'Downloading…' : `Download ${kind} document`;
          return (
            <Action
              key={kind}
              label={label}
              accessibilityLabel={`${label} (${context})`}
              disabled={download.isPending}
              onPress={() => download.mutate(kind)}
            />
          );
        })}
      </View>
      {download.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {apiErrorSentence(download.error, REGISTER_COPY.DOWNLOAD_FAILED, REGISTER_COPY.DOWNLOAD_FAILED)}
        </Text>
      )}
    </>
  );
}
