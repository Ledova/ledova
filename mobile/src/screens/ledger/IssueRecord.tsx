import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CaretDownIcon, CaretUpIcon } from 'phosphor-react-native';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  REGISTER_COPY,
  apiErrorSentence,
  formatDateTime,
  type RegisterDecisionKind,
  type RegisterProposal,
} from '@ledova/shared';
import { Action, Fact, Status, type Tone } from '../../components/Ledger';
import { useAppTheme } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useLedgerStyles } from './useLedgerStyles';

export function SummaryCell({
  label,
  values,
  children,
}: {
  label: string;
  values: (string | undefined)[];
  children: ReactNode;
}) {
  const look = useLedgerStyles();
  return (
    <View accessible accessibilityLabel={`${label}: ${values.filter(Boolean).join(', ')}`} style={look.cell}>
      <Text style={look.muted}>{label}</Text>
      {children}
    </View>
  );
}

export function RecordSummary({
  name,
  figure,
  facts,
  amount,
  status,
  children,
}: {
  name: string;
  figure?: string;
  facts: string;
  amount?: string;
  status?: { tone: Tone; label: string };
  children: ReactNode;
}) {
  const theme = useAppTheme();
  const look = useLedgerStyles();
  const [open, setOpen] = useState(false);
  const Caret = open ? CaretUpIcon : CaretDownIcon;
  return (
    <>
      <View style={look.list}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}${figure ? `, ${figure}` : ''}. ${open ? 'Hide' : 'Show'} details and documents`}
          accessibilityHint={amount ? `${facts}, ${amount}` : facts}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((shown) => !shown)}
          style={look.disclosure}
        >
          <View style={[look.fill, look.terms]}>
            <View style={look.split}>
              <Text style={[look.title, look.fill]}>{name}</Text>
              {!!figure && <Text style={[look.title, look.tabular]}>{figure}</Text>}
            </View>
            <View style={look.split}>
              <Text style={[look.small, look.fill]}>{facts}</Text>
              {!!amount && <Text style={[look.small, look.tabular]}>{amount}</Text>}
            </View>
          </View>
          <Caret size={theme.icon.sizes.sm} color={theme.colors.text.muted} />
        </Pressable>
        {!!status && (
          <View accessible accessibilityLabel={`Status: ${status.label}`}>
            <Status tone={status.tone}>{status.label}</Status>
          </View>
        )}
      </View>
      <View style={[look.summary, !open && look.hidden]}>{children}</View>
    </>
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
