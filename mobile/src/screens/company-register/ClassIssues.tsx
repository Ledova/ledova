import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import type { OwnCompanyAppointment, RegisterStep, TokenHoldersResponse } from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { entriesKey, grantsKey, registerHoldersKey, transferMembersKey } from '../../hooks/useCompanyRegister';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';
import { allotmentsKey } from './useRegisterAllotments';
import { awardsKey } from './useRegisterAwards';
import { useTaskFreshness } from './useTaskFreshness';

const HIDDEN = { display: 'none' } as const;

const KINDS = [
  ['investor', 'Investor issue'],
  ['nonpaid', 'Non-paid issue'],
] as const;

type IssueKind = (typeof KINDS)[number][0];

export interface IssueRequest {
  key: string;
  member?: string;
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
  visible,
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
  visible: boolean;
}) {
  const styles = useCompanyStyles();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [kind, setKind] = useState<IssueKind | ''>('');
  const [award, setAward] = useState<string | undefined>();
  const [member, setMember] = useState<string | undefined>();
  const [answered, setAnswered] = useState('');
  const onReviewChange = useCallback(
    (uuid: string, open: boolean) => setReviewing((current) => (open ? uuid : current === uuid ? null : current)),
    [],
  );
  const close = () => {
    setPreparing(false);
    setKind('');
    setAward(undefined);
    setMember(undefined);
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
    issueMember: member,
    open: preparing && kind === 'investor',
    kept: preparing,
    onClosed: close,
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
    open: preparing && kind === 'nonpaid',
    kept: preparing,
    onClosed: close,
    reviewing,
    onReviewChange,
  });
  const token = register.token.uuid;
  useTaskFreshness({
    epoch,
    company,
    visible,
    sourceReady,
    paused: preparing || !!reviewing,
    records: [grantsKey(epoch, token), allotmentsKey(epoch, token)],
    related: [
      registerHoldersKey(epoch),
      awardsKey(epoch, token),
      entriesKey(epoch, token),
      transferMembersKey(epoch, token),
    ],
    refreshRecords: () => Promise.allSettled([investor.refreshRecords(), nonPaid.refreshRecords()]),
    interval: 60_000,
  });
  const held = investor.held || nonPaid.held;
  if (request && answered !== request.key && !held) {
    setAnswered(request.key);
    if (request.award || request.member) {
      setPreparing(true);
      setKind(request.award ? 'nonpaid' : 'investor');
      setAward(request.award);
      setMember(request.member);
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
        </Section>
      </View>
      {browsing && investor.prepare && (
        <View style={styles.actions}>
          <Action
            label="Prepare issue"
            accessibilityLabel={`Prepare issue for ${register.token.name}`}
            primary
            disabled={held || !sourceReady}
            onPress={() => setPreparing(true)}
          />
        </View>
      )}
      <View style={preparing ? undefined : HIDDEN}>
        <Section title="Prepare share issue">
          {preparing && investor.status}
          {preparing && nonPaid.status}
          <View style={styles.group}>
            <Text style={styles.text}>What kind of issue?</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="What kind of issue?" style={styles.choices}>
              {KINDS.map(([value, label]) => (
                <Choice
                  key={value}
                  label={label}
                  accessibilityRole="radio"
                  selected={kind === value}
                  disabled={held}
                  onPress={() => setKind(value)}
                />
              ))}
            </View>
          </View>
          {investor.form}
          {nonPaid.form}
          {(!kind || (kind === 'investor' && !investor.formShown)) && (
            <View style={styles.actions}>
              <Action label="Cancel" disabled={held} onPress={close} />
            </View>
          )}
        </Section>
      </View>
    </>
  );
}
