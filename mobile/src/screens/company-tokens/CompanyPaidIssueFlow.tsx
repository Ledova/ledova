import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  COMPANY_TOKEN_ENDPOINTS,
  useCompanyPaidIssues,
  REGISTER_PAID_ISSUE_COPY as COPY,
  REGISTER_PAID_ISSUE_DECISIONS,
  REGISTER_PAID_ISSUE_UNMET_COPY,
  formatDateTime,
  formatMoney,
  formatShareCount,
  type RegisterPaidIssueSource,
  getErrorMessage,
  registerPaidIssueExecutionState,
  type RegisterPaidIssue,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RegisterCopy } from '../company-register/RegisterCopy';
import { RegisterDecision } from '../company-register/RegisterDecision';
import { EvidencePicker, Field } from '../company-register/RegisterFields';
import { useRegisterEvidence } from '../company-register/useRegisterEvidence';
import { useCompanyStyles } from '../company-register/styles';
import type { useTokenDetail } from './useTokenDetail';

type Commands = ReturnType<typeof useCompanyPaidIssues>;
const STAGES: Record<string, string> = COPY.STAGES;
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

function SourceRows({ source }: { source: RegisterPaidIssueSource }) {
  return (
    <Rows>
      <Row label="Subscription">{source.subscription}</Row>
      <Row label="Offering">{source.offering}</Row>
      <Row label="Recipient">
        {source.recipientName || 'Name not recorded'} · {source.recipientAddress}
      </Row>
      <Row label="Requested shares">{formatShareCount(source.requestedShares)}</Row>
      <Row label="Recorded allotment">{formatShareCount(source.shares)}</Row>
      <Row label="Price per share">{formatMoney(source.pricePerShare, source.currency)}</Row>
      <Row label="Original due">{formatMoney(source.amountDue, source.currency)}</Row>
      <Row label="Recorded received">
        {source.amountReceived === null ? 'Not recorded' : formatMoney(source.amountReceived, source.currency)}
      </Row>
      <Row label="Recorded money held">{formatMoney(source.moneyHeld, source.currency)}</Row>
      <Row label={source.refundedAt ? 'Captured refunded amount' : 'Captured refund amount owed'}>
        {source.refundAmount === null ? 'Not recorded' : formatMoney(source.refundAmount, source.currency)}
      </Row>
      <Row label="Refund recorded in captured source">
        {source.refundedAt ? formatDateTime(source.refundedAt) : 'No refund recorded'}
      </Row>
      <Row label="Payment received date">{source.paymentReceivedOn || 'Not recorded'}</Row>
      <Row label="Recorded payment reference">{source.paymentReferenceSeen || 'Not recorded'}</Row>
      <Row label="Recorded payment hash">{source.paymentTxHash || 'Not recorded'}</Row>
      <Row label="Payment recorded on">
        {source.paymentConfirmedAt ? formatDateTime(source.paymentConfirmedAt) : 'Not recorded'}
      </Row>
    </Rows>
  );
}

function SnapshotRows({
  record,
}: {
  record: Pick<RegisterPaidIssue, 'snapshot' | 'shares' | 'approvingDirector' | 'reason' | 'authorityReference'>;
}) {
  const styles = useCompanyStyles();
  return (
    <>
      <Rows>
        <Row label="Company">
          {record.snapshot.company.name} · ACN {record.snapshot.company.acn}
        </Row>
        <Row label="Share class">
          {record.snapshot.token.name} · {record.snapshot.token.symbol}
        </Row>
        <Row label="Approving director">{record.approvingDirector}</Row>
        <Row label="Issue reason">{record.reason}</Row>
        <Row label="Authority reference">{record.authorityReference}</Row>
        <Row label="Contract">{record.snapshot.token.contractAddress}</Row>
        <Row label="Technical sender">{record.snapshot.transaction.sender}</Row>
      </Rows>
      <SourceRows source={record.snapshot.source} />
      <Text style={styles.muted}>{COPY.PAYMENT_NOTE}</Text>
    </>
  );
}

function PaidIssueRecord({
  record,
  commands,
  epoch,
}: {
  record: RegisterPaidIssue;
  commands: Commands;
  epoch: number;
}) {
  const styles = useCompanyStyles();
  const execution = record.execution;
  const description = `company paid issue ${record.uuid}, prepared ${formatDateTime(record.createdAt)}`;
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>{STAGES[record.stage] ?? record.stage} paid issue</Text>
      <SnapshotRows record={record} />
      <Rows>
        <Row label="Preparation ID">{record.uuid}</Row>
        <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>

        <Row label="Intent fingerprint">{record.intentDigest}</Row>
        {record.decisions.map((decision) => (
          <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt), decision.reason].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!record.rejectionReason && <Row label="Rejection reason">{record.rejectionReason}</Row>}
        {!!record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
        <Row label="Execution">{registerPaidIssueExecutionState(record)}</Row>
        <Row label="Original subscription status">{record.subscriptionStatus}</Row>
        <Row label="Actual allotment recorded">
          {record.allottedAt ? formatDateTime(record.allottedAt) : 'Not recorded'}
        </Row>
        <Row label="Original issuance request">{record.request || 'No issuance request admitted'}</Row>
        {execution && (
          <>
            <Row label="Original execution">{execution.execution}</Row>
            <Row label="Original dispatch">{execution.dispatchId}</Row>
            {!!execution.operationId && <Row label="Original operation">{execution.operationId}</Row>}
            {!!execution.claimId && <Row label="Original claim">{execution.claimId}</Row>}
            {!!execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
            {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
            {!!execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
            <Row label="Original completion date">
              {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
            </Row>
            <Row label="Original issuance">{execution.issuance || 'Not recorded'}</Row>
            <Row label="Register entry">{execution.registerEntry || 'Not recorded'}</Row>
            <Row label="Entry effective date">{execution.effectiveOn || 'Not recorded'}</Row>
          </>
        )}
      </Rows>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <Text style={styles.muted}>{COPY.ADMITTED_NOTE}</Text>
      {record.executionUnmetRequirements.map((code) => (
        <Text key={code} style={styles.muted}>
          {REGISTER_PAID_ISSUE_UNMET_COPY[code] ?? code}
        </Text>
      ))}
      <RegisterCopy
        label="Download paid issue authority"
        accessibilityLabel={`Download authority document of ${description}`}
        filename={`paid-issue-authority-${record.uuid}`}
        epoch={epoch}
        guard={commands.guard}
        read={() => {
          commands.guard();
          return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PAID_ISSUE_FILE(record.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: commands.guard,
          });
        }}
      />
      <View style={styles.choices}>
        {KINDS.map((kind) => (
          <RegisterDecision
            key={kind}
            family={REGISTER_PAID_ISSUE_DECISIONS}
            copy={COPY}
            noun="paid issue"
            proposal={record}
            kind={kind}
            appointment={commands.steps[kind]?.uuid}
            enabled={commands.visible && record.status === 'submitted'}
            visible={commands.visible}
            readGuard={commands.guard}
            newEffectGuard={() => commands.guardPaidIssue(kind, record)}
            epoch={epoch}
            description={description}
            onDecided={commands.accept}
            onSettled={commands.refresh}
            onRefused={commands.refresh}
          >
            {(preview) => (
              <>
                <SnapshotRows record={preview} />
                <Text style={styles.muted}>{COPY.NOTE}</Text>
              </>
            )}
          </RegisterDecision>
        ))}
      </View>
    </View>
  );
}

function Preparation({ commands }: { commands: Commands }) {
  const styles = useCompanyStyles();
  const [captured, setCaptured] = useState<Parameters<Commands['prepare']>[1] | null>(null);
  const [director, setDirector] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authority = useRegisterEvidence(commands.company, 'authority');
  const busy = submitting || commands.busy || authority.busy;
  const termsValid =
    !!captured &&
    !!director.trim() &&
    director.trim().length <= 255 &&
    !!reason.trim() &&
    reason.trim().length <= 1000 &&
    !!reference.trim() &&
    reference.trim().length <= 255;
  const freshGuard = () => {
    if (!captured) throw new Error('Choose an exact recorded paid subscription.');
    commands.guardPaidIssue('prepare', captured);
  };
  const select = (subscription: string) => {
    try {
      const source = commands.availableSubscriptions.data?.find((row) => row.subscription === subscription);
      if (!source) throw new Error('Choose an available recorded paid subscription.');
      const next = { source: { ...source }, token: commands.source ? { ...commands.source } : undefined };
      commands.guardPaidIssue('prepare', next);
      setCaptured(next);
      authority.clear();
      setError(null);
    } catch (failure) {
      setError(getErrorMessage(failure, 'The paid source could not be selected.'));
    }
  };
  const pick = async () => {
    setError(null);
    try {
      freshGuard();
      await authority.pick();
      freshGuard();
    } catch (failure) {
      try {
        commands.guard();
        setError(getErrorMessage(failure, 'The authority document could not be selected.'));
      } catch {
        return;
      }
    }
  };
  const submit = async () => {
    if (busy || !commands.canPrepare || commands.recovery || !termsValid || !authority.name || !captured) return;
    setSubmitting(true);
    setError(null);
    try {
      freshGuard();
      const receipt = await authority.upload(commands.steps.prepare!.uuid, freshGuard);
      freshGuard();
      await commands.prepare(
        {
          subscription: captured.source.subscription,
          approvingDirector: director.trim(),
          reason: reason.trim(),
          authorityReference: reference.trim(),
          authorityEvidence: receipt.uuid,
        },
        captured,
      );
    } catch (failure) {
      try {
        commands.guard();
        setError(getErrorMessage(failure, 'The paid issue could not be prepared.'));
      } catch {
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };
  const candidates = commands.availableSubscriptions.data ?? [];
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Prepare a company paid issue</Text>
      <Text style={styles.muted}>{COPY.PAYMENT_NOTE}</Text>
      {commands.availableSubscriptions.isPending && <Text style={styles.muted}>Loading recorded paid sources…</Text>}
      {commands.availableSubscriptions.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          Available paid subscription sources could not be refreshed. The captured draft remains, and fresh evidence is
          blocked.
        </Text>
      )}
      {commands.availableSubscriptions.isSuccess &&
        !commands.availableSubscriptions.isFetching &&
        candidates.length === 0 && (
          <Text style={styles.muted}>
            No available paid subscription for this class. Existing admitted sources retain their original outcomes.
          </Text>
        )}
      <Text style={styles.text}>Recorded paid subscription</Text>
      {candidates.map((row) => (
        <Action
          key={row.subscription}
          label={`${row.subscription} · ${formatShareCount(row.shares)} shares · ${row.recipientAddress}`}
          primary={captured?.source.subscription === row.subscription}
          disabled={busy}
          onPress={() => select(row.subscription)}
        />
      ))}
      {captured && <SourceRows source={captured.source} />}
      <Action
        label="Use current recorded source"
        disabled={busy || !commands.canPrepare || !captured}
        onPress={() => {
          if (captured) select(captured.source.subscription);
        }}
      />
      <Field label="Approving director" value={director} editable={!busy} maxLength={255} onChange={setDirector} />
      <Text style={styles.muted}>
        The company names a director other than the recipient. No director account is required.
      </Text>
      <Field label="Authority reference" value={reference} editable={!busy} maxLength={255} onChange={setReference} />
      <Field
        label="Paid issue reason"
        value={reason}
        editable={!busy}
        multiline
        maxLength={1000}
        onChange={setReason}
      />
      <EvidencePicker
        title="Paid issue authority document"
        noun="paid issue authority document"
        evidence={authority}
        disabled={busy || !commands.canPrepare || !termsValid}
        onPick={() => void pick()}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={submitting ? 'Preparing…' : 'Prepare paid issue'}
        primary
        disabled={busy || !commands.canPrepare || !!commands.recovery || !termsValid || !authority.name}
        onPress={() => void submit()}
      />
    </View>
  );
}

export function CompanyPaidIssueFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useTokenDetail> }) {
  const styles = useCompanyStyles();
  const commands = useCompanyPaidIssues(apiClient, uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => Crypto.randomUUID(),
    session: orderSubmissionSession,
  });
  const [draftOwner, setDraftOwner] = useState(commands.owner);
  useEffect(() => setDraftOwner(commands.owner), [commands.owner]);
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <Action
        label="Refresh company paid issue records"
        disabled={commands.busy}
        onPress={() => void commands.refresh()}
      />
      {!commands.visible && (
        <Text style={styles.muted}>
          Current personal register access for this company is required. Retained requests stay private until it is
          refreshed.
        </Text>
      )}
      {commands.visible && !commands.steps.prepare && (
        <Text style={styles.muted}>
          You can read company paid issue history. Preparation requires current company administration or prepare
          capability.
        </Text>
      )}
      {commands.visible && commands.instructions.isPending && (
        <Text style={styles.muted}>Loading company paid issue records…</Text>
      )}
      {commands.visible && commands.instructions.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          The paid issue records could not be refreshed. Retained original receipts remain available.
        </Text>
      )}
      {draftOwner === commands.owner && !!commands.company && (
        <View style={!commands.visible || !commands.steps.prepare ? { display: 'none' } : undefined}>
          <Preparation key={commands.scopeKey} commands={commands} />
        </View>
      )}
      {commands.visible && commands.recovery && (
        <View style={styles.group}>
          <Text style={styles.muted}>
            The original paid issue preparation response is unresolved. Recover its identical body and operation UUID.
          </Text>
          <Text selectable style={styles.text}>
            {commands.recovery.body.operationId}
          </Text>
          <Action
            label="Recover original paid issue preparation receipt"
            disabled={commands.busy}
            onPress={() => void commands.recover()}
          />
        </View>
      )}
      {commands.visible && commands.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {commands.error}
        </Text>
      )}
      <View style={!commands.visible ? { display: 'none' } : undefined}>
        {commands.records.map((record) => (
          <PaidIssueRecord key={record.uuid} record={record} commands={commands} epoch={data.epoch} />
        ))}
      </View>
    </Section>
  );
}
