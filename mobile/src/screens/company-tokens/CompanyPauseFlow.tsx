import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  COMPANY_TOKEN_ENDPOINTS,
  useCompanyPauseChanges,
  REGISTER_PAUSE_CHANGE_COPY as COPY,
  REGISTER_PAUSE_CHANGE_DECISIONS,
  REGISTER_PAUSE_CHANGE_UNMET_COPY,
  formatDateTime,
  getErrorMessage,
  registerPauseChangeExecutionState,
  type RegisterPauseChange,
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

type Commands = ReturnType<typeof useCompanyPauseChanges>;
const STAGES: Record<string, string> = COPY.STAGES;
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

function SnapshotRows({
  record,
}: {
  record: Pick<RegisterPauseChange, 'snapshot' | 'paused' | 'reason' | 'authorityReference'>;
}) {
  return (
    <Rows>
      <Row label="Company">
        {record.snapshot.company.name} · ACN {record.snapshot.company.acn}
      </Row>
      <Row label="Share class">
        {record.snapshot.token.name} · {record.snapshot.token.symbol}
      </Row>
      <Row label="Requested state">
        {record.paused === true ? 'Paused' : record.paused === false ? 'Unpaused' : 'Not recorded'}
      </Row>
      <Row label="Reason">{record.reason}</Row>
      <Row label="Authority reference">{record.authorityReference}</Row>
      <Row label="Contract">{record.snapshot.token.contractAddress}</Row>
      <Row label="Technical sender">{record.snapshot.transaction.sender}</Row>
    </Rows>
  );
}

function PauseRecord({ record, commands, epoch }: { record: RegisterPauseChange; commands: Commands; epoch: number }) {
  const styles = useCompanyStyles();
  const execution = record.execution;
  const description = `company pause change ${record.uuid}, prepared ${formatDateTime(record.createdAt)}`;
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>{STAGES[record.stage] ?? record.stage} pause change</Text>
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
        <Row label="Execution">{registerPauseChangeExecutionState(record)}</Row>
        {execution && (
          <>
            <Row label="Original submission">{execution.submissionId}</Row>
            {!!execution.operationId && <Row label="Original operation">{execution.operationId}</Row>}
            {!!execution.claimId && <Row label="Original claim">{execution.claimId}</Row>}
            {!!execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
            {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
            {!!execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
            {execution.gasUsed !== null && <Row label="Original receipt gas used">{execution.gasUsed}</Row>}
            {execution.observation && (
              <>
                <Row label="Original observation block">{execution.observation.blockNumber}</Row>
                <Row label="Original observation block hash">{execution.observation.blockHash}</Row>
                <Row label="Original observation time">{formatDateTime(execution.observation.observedAt)}</Row>
              </>
            )}
            <Row label="Original completion date">
              {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
            </Row>
          </>
        )}
      </Rows>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <Text style={styles.muted}>{COPY.ADMITTED_NOTE}</Text>
      {record.executionUnmetRequirements.map((code) => (
        <Text key={code} style={styles.muted}>
          {REGISTER_PAUSE_CHANGE_UNMET_COPY[code] ?? code}
        </Text>
      ))}
      <RegisterCopy
        label="Download pause authority"
        accessibilityLabel={`Download authority document of ${description}`}
        filename={`pause-authority-${record.uuid}`}
        epoch={epoch}
        guard={commands.guard}
        read={() => {
          commands.guard();
          return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PAUSE_CHANGE_FILE(record.uuid), {
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
            family={REGISTER_PAUSE_CHANGE_DECISIONS}
            copy={COPY}
            noun="pause change"
            proposal={record}
            kind={kind}
            appointment={commands.steps[kind]?.uuid}
            enabled={commands.visible && record.status === 'submitted'}
            visible={commands.visible}
            readGuard={commands.guard}
            newEffectGuard={() => commands.guardPause(kind, record)}
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
  const [captured, setCaptured] = useState(() => (commands.source ? { ...commands.source } : undefined));
  const [paused, setPaused] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authority = useRegisterEvidence(commands.company, 'authority');
  const busy = submitting || commands.busy || authority.busy;
  const termsValid =
    paused !== null &&
    !!reason.trim() &&
    reason.trim().length <= 1000 &&
    !!reference.trim() &&
    reference.trim().length <= 255;
  const freshGuard = () =>
    commands.guardPause('prepare', {
      token: captured,
      paused: paused!,
      reason: reason.trim(),
      authorityReference: reference.trim(),
    });
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
    if (busy || !commands.canPrepare || commands.recovery || !termsValid || !authority.name) return;
    setSubmitting(true);
    setError(null);
    try {
      freshGuard();
      const receipt = await authority.upload(commands.steps.prepare!.uuid, freshGuard);
      freshGuard();
      await commands.prepare(
        {
          paused: paused!,
          reason: reason.trim(),
          authorityReference: reference.trim(),
          authorityEvidence: receipt.uuid,
        },
        captured,
      );
    } catch (failure) {
      try {
        commands.guard();
        setError(getErrorMessage(failure, 'The pause change could not be prepared.'));
      } catch {
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Prepare a company pause change</Text>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <Action
        label="Use current class details"
        disabled={busy || !commands.canPrepare}
        onPress={() => {
          commands.guardStep('prepare');
          setCaptured(commands.source ? { ...commands.source } : undefined);
        }}
      />
      <Text style={styles.text}>
        Requested state: {paused === null ? 'Choose a state' : paused ? 'Paused' : 'Unpaused'}
      </Text>
      <View style={styles.choices}>
        <Action label="Request pause" disabled={busy} onPress={() => setPaused(true)} />
        <Action label="Request unpause" disabled={busy} onPress={() => setPaused(false)} />
      </View>
      <Field label="Pause reason" value={reason} editable={!busy} multiline maxLength={1000} onChange={setReason} />
      <Field label="Authority reference" value={reference} editable={!busy} maxLength={255} onChange={setReference} />
      <EvidencePicker
        title="Pause authority document"
        noun="pause authority document"
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
        label={submitting ? 'Preparing…' : 'Prepare pause change'}
        primary
        disabled={busy || !commands.canPrepare || !!commands.recovery || !termsValid || !authority.name}
        onPress={() => void submit()}
      />
    </View>
  );
}

export function CompanyPauseFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useTokenDetail> }) {
  const styles = useCompanyStyles();
  const commands = useCompanyPauseChanges(apiClient, uuid, {
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
      <Action label="Refresh company pause records" disabled={commands.busy} onPress={() => void commands.refresh()} />
      {!commands.visible && (
        <Text style={styles.muted}>
          Current personal register access for this company is required. Retained requests stay private until it is
          refreshed.
        </Text>
      )}
      {commands.visible && !commands.steps.prepare && (
        <Text style={styles.muted}>
          You can read company pause history. Preparation requires current company administration or prepare capability.
        </Text>
      )}
      {commands.visible && commands.instructions.isPending && (
        <Text style={styles.muted}>Loading company pause records…</Text>
      )}
      {commands.visible && commands.instructions.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          The pause records could not be refreshed. Retained original receipts remain available.
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
            The original pause preparation response is unresolved. Recover its identical body and operation UUID.
          </Text>
          <Text selectable style={styles.text}>
            {commands.recovery.body.operationId}
          </Text>
          <Action
            label="Recover original pause preparation receipt"
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
          <PauseRecord key={record.uuid} record={record} commands={commands} epoch={data.epoch} />
        ))}
      </View>
    </Section>
  );
}
