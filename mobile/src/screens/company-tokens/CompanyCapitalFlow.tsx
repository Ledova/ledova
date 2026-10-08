import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  COMPANY_TOKEN_ENDPOINTS,
  useCompanyCapitalIncreases,
  REGISTER_CAPITAL_INCREASE_COPY as COPY,
  REGISTER_CAPITAL_INCREASE_DECISIONS,
  REGISTER_CAPITAL_INCREASE_UNMET_COPY,
  formatDateTime,
  formatShareCount,
  getErrorMessage,
  raisedSupply,
  requestShares,
  registerCapitalIncreaseExecutionState,
  type RegisterCapitalIncrease,
  type RegisterCapitalIncreaseSnapshot,
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

type Commands = ReturnType<typeof useCompanyCapitalIncreases>;
const STAGES: Record<string, string> = COPY.STAGES;
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

function SnapshotRows({ snapshot }: { snapshot: RegisterCapitalIncreaseSnapshot }) {
  return (
    <Rows>
      <Row label="Company">
        {snapshot.company.name} · ACN {snapshot.company.acn}
      </Row>
      <Row label="Share class">
        {snapshot.token.name} · {snapshot.token.symbol}
      </Row>
      <Row label="Captured authorised cap">{formatShareCount(snapshot.capital.priorAuthorizedTotal)}</Row>
      <Row label="Increase">{formatShareCount(snapshot.capital.additionalShares)}</Row>
      <Row label="New authorised cap">{formatShareCount(snapshot.capital.newAuthorizedTotal)}</Row>
      <Row label="Purpose">{snapshot.capital.purpose}</Row>
      <Row label="Board resolution reference">{snapshot.capital.boardResolutionReference}</Row>
      <Row label="Shareholder approval reference">
        {snapshot.capital.shareholderApprovalReference || 'Not provided'}
      </Row>
      <Row label="Shares minted">0</Row>
      <Row label="Contract">{snapshot.token.contractAddress}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
    </Rows>
  );
}

function CapitalRecord({
  record,
  commands,
  epoch,
}: {
  record: RegisterCapitalIncrease;
  commands: Commands;
  epoch: number;
}) {
  const styles = useCompanyStyles();
  const execution = record.execution;
  const description = `company capital increase ${record.uuid}, prepared ${formatDateTime(record.createdAt)}`;
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>{STAGES[record.stage] ?? record.stage} capital increase</Text>
      <SnapshotRows snapshot={record.snapshot} />
      <Rows>
        <Row label="Preparation ID">{record.uuid}</Row>
        <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
        <Row label="Original request">{record.request}</Row>
        <Row label="Intent fingerprint">{record.intentDigest}</Row>
        {record.decisions.map((decision) => (
          <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt), decision.reason].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!record.rejectionReason && <Row label="Rejection reason">{record.rejectionReason}</Row>}
        {!!record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
        <Row label="Execution">{registerCapitalIncreaseExecutionState(record)}</Row>
        {execution && (
          <>
            <Row label="Original execution">{execution.execution}</Row>
            <Row label="Dispatch">{execution.dispatchId}</Row>
            {!!execution.operationId && <Row label="Original operation">{execution.operationId}</Row>}
            {!!execution.claimId && <Row label="Original claim">{execution.claimId}</Row>}
            {!!execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
            {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
            {!!execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
            {execution.gasUsed !== null && <Row label="Original receipt gas used">{execution.gasUsed}</Row>}
            <Row label="Original projection date">
              {execution.projectedAt ? formatDateTime(execution.projectedAt) : 'Not recorded'}
            </Row>
          </>
        )}
      </Rows>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <Text style={styles.muted}>{COPY.ADMITTED_NOTE}</Text>
      {record.executionUnmetRequirements.map((code) => (
        <Text key={code} style={styles.muted}>
          {REGISTER_CAPITAL_INCREASE_UNMET_COPY[code] ?? code}
        </Text>
      ))}
      <RegisterCopy
        label="Download capital authority"
        accessibilityLabel={`Download authority document of ${description}`}
        filename={`capital-authority-${record.uuid}`}
        epoch={epoch}
        guard={commands.guard}
        read={() => {
          commands.guard();
          return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CAPITAL_INCREASE_FILE(record.uuid), {
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
            family={REGISTER_CAPITAL_INCREASE_DECISIONS}
            copy={COPY}
            noun="capital increase"
            proposal={record}
            kind={kind}
            appointment={commands.steps[kind]?.uuid}
            enabled={commands.visible && record.status === 'submitted'}
            visible={commands.visible}
            readGuard={commands.guard}
            newEffectGuard={() => commands.guardCapital(kind, record)}
            epoch={epoch}
            description={description}
            onDecided={commands.accept}
            onSettled={commands.refresh}
            onRefused={commands.refresh}
          >
            {(preview) => (
              <>
                <SnapshotRows snapshot={preview.snapshot} />
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
  const [before, setBefore] = useState(() => commands.source?.totalSupply ?? '');
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [board, setBoard] = useState('');
  const [shareholder, setShareholder] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authority = useRegisterEvidence(commands.company, 'authority');
  const additionalShares = requestShares(additional);
  const total = raisedSupply(before, additional);
  const newAuthorizedTotal = total === null ? null : requestShares(total);
  const busy = submitting || commands.busy || authority.busy;
  const valid =
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    !!purpose.trim() &&
    !!board.trim() &&
    board.trim().length <= 255 &&
    shareholder.trim().length <= 255 &&
    !!authority.name;
  const freshGuard = () =>
    commands.guardCapital('prepare', {
      priorAuthorizedTotal: before,
      additionalShares: additionalShares!,
      newAuthorizedTotal: newAuthorizedTotal!,
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
    if (busy || !commands.canPrepare || commands.recovery || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      freshGuard();
      const receipt = await authority.upload(commands.steps.prepare!.uuid, freshGuard);
      freshGuard();
      await commands.prepare(
        {
          additionalShares: additionalShares!,
          newAuthorizedTotal: newAuthorizedTotal!,
          purpose: purpose.trim(),
          boardResolutionReference: board.trim(),
          shareholderApprovalReference: shareholder.trim(),
          authorityEvidence: receipt.uuid,
        },
        before,
      );
    } catch (failure) {
      try {
        commands.guard();
        setError(getErrorMessage(failure, 'The capital increase could not be prepared.'));
      } catch {
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Prepare a company capital increase</Text>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <Text style={styles.text}>Captured authorised cap: {formatShareCount(before)}</Text>
      {commands.source?.totalSupply !== before && (
        <Action
          label="Use current authorised cap"
          disabled={busy || !commands.canPrepare}
          onPress={() => {
            commands.guardStep('prepare');
            setBefore(commands.source!.totalSupply);
          }}
        />
      )}
      <Field
        label="Additional authorised shares"
        value={additional}
        editable={!busy}
        keyboardType="number-pad"
        onChange={setAdditional}
      />
      {total !== null && <Text style={styles.text}>New authorised cap: {formatShareCount(total)}</Text>}
      {additional !== '' && (additionalShares === null || newAuthorizedTotal === null) && (
        <Text accessibilityRole="alert" style={styles.error}>
          Enter positive whole shares with an exact new cap no greater than 2,147,483,647.
        </Text>
      )}
      <Field label="Purpose" value={purpose} editable={!busy} multiline onChange={setPurpose} />
      <Field label="Board resolution reference" value={board} editable={!busy} maxLength={255} onChange={setBoard} />
      <Field
        label="Shareholder approval reference (optional)"
        value={shareholder}
        editable={!busy}
        maxLength={255}
        onChange={setShareholder}
      />
      <EvidencePicker
        title="Capital authority document"
        noun="capital authority document"
        evidence={authority}
        disabled={busy || !commands.canPrepare || additionalShares === null || newAuthorizedTotal === null}
        onPick={() => void pick()}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={submitting ? 'Preparing…' : 'Prepare capital increase'}
        primary
        disabled={busy || !commands.canPrepare || !!commands.recovery || !valid}
        onPress={() => void submit()}
      />
    </View>
  );
}

export function CompanyCapitalFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useTokenDetail> }) {
  const styles = useCompanyStyles();
  const commands = useCompanyCapitalIncreases(apiClient, uuid, {
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
        label="Refresh company capital records"
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
          You can read company capital history. Preparation requires current company administration or prepare
          capability.
        </Text>
      )}
      {commands.visible && commands.instructions.isPending && (
        <Text style={styles.muted}>Loading company capital records…</Text>
      )}
      {commands.visible && commands.instructions.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          The capital records could not be refreshed. Retained original receipts remain available.
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
            The original capital preparation response is unresolved. Recover its identical body and operation UUID.
          </Text>
          <Text selectable style={styles.text}>
            {commands.recovery.body.operationId}
          </Text>
          <Action
            label="Recover original capital preparation receipt"
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
          <CapitalRecord key={record.uuid} record={record} commands={commands} epoch={data.epoch} />
        ))}
      </View>
    </Section>
  );
}
