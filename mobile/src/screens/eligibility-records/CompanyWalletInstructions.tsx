import { useState, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { Text, View } from 'react-native';
import {
  formatDateTime,
  useCompanyWalletInstructions,
  companyWalletExecutionState,
  COMPANY_WALLET_COPY as COPY,
  COMPANY_WALLET_DECISIONS,
  COMPANY_WALLET_UNMET_COPY,
  type CompanyWalletInstruction,
  type CompanyWalletDecisionPreview,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RegisterDecision } from '../company-register/RegisterDecision';
import { useCompanyStyles } from '../company-register/styles';
import { EligibilityExpiry } from './EligibilityExpiry';

type Read = ReturnType<typeof useCompanyWalletInstructions>;

function SnapshotRows({ snapshot }: { snapshot: CompanyWalletInstruction['snapshot'] }) {
  return (
    <Rows>
      <Row label="Company">{snapshot.company.name}</Row>
      <Row label="Company ACN">{snapshot.company.acn}</Row>
      <Row label="Address">{snapshot.target.address}</Row>
      <Row label="Chain">{snapshot.target.chain}</Row>
      <Row label="Chain ID">{snapshot.target.chainId}</Row>
      <Row label="Registry">{snapshot.target.registryAddress}</Row>
      <Row label="Approval expiry">{formatDateTime(snapshot.target.expiresAt)}</Row>
      <Row label="Shared nomination">{snapshot.source.nomination ?? 'Removal of a retained target'}</Row>
      <Row label="Original ADD target">{snapshot.source.targetChange ?? 'Not applicable'}</Row>
      <Row label="Eligibility request">{snapshot.source.request ?? 'Not applicable'}</Row>
      <Row label="Accepted GENERAL decision">{snapshot.source.decision ?? 'Not applicable'}</Row>
      <Row label="Possession proof completed">{formatDateTime(snapshot.source.proofCompletedAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(snapshot.source.eligibilityExpiresAt)}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
      <Row label="Transaction destination">{snapshot.transaction.to}</Row>
      <Row label="Transaction value">{snapshot.transaction.value}</Row>
      <Row label="Transaction data">{snapshot.transaction.data}</Row>
    </Rows>
  );
}

function InstructionRecord({ record, data }: { record: CompanyWalletInstruction; data: Read }) {
  const styles = useCompanyStyles();
  const execution = record.execution;
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  return (
    <View style={styles.entry}>
      {data.canRead && (
        <>
          <Text style={styles.heading}>
            {record.action} · {record.stage}
          </Text>
          <Text style={styles.muted}>
            Provided by the company. Human approval and technical execution are recorded separately.
          </Text>
          <SnapshotRows snapshot={record.snapshot} />
          <Rows>
            <Row label="Instruction">{record.uuid}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.decisions.map((decision) => (
              <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
                {[decision.decidedByName, formatDateTime(decision.decidedAt), decision.reason]
                  .filter(Boolean)
                  .join(' · ')}
              </Row>
            ))}
            {!!record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
            {!!record.changeId && <Row label="Original wallet change">{record.changeId}</Row>}
            <Row label="Execution">{companyWalletExecutionState(record)}</Row>
            {!!execution?.operationId && <Row label="Execution operation">{execution.operationId}</Row>}
            {!!execution?.claimId && <Row label="Original claim">{execution.claimId}</Row>}
            {!!execution?.operationStatus && <Row label="Operation state">{execution.operationStatus}</Row>}
            {!!execution?.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
            {!!execution?.failureCode && <Row label="Failure">{execution.failureCode}</Row>}
          </Rows>
          {!!record.changeId && (
            <Text style={styles.muted}>
              The original change was admitted. Its journal determines whether execution is unsigned, signed, observed
              unchanged, confirmed or failed.
            </Text>
          )}
          {record.executionUnmetRequirements.map((code) => (
            <Text key={code} style={styles.muted}>
              {COMPANY_WALLET_UNMET_COPY[code] ?? code}
            </Text>
          ))}
        </>
      )}
      {(['approve', 'apply', 'reject'] as RegisterDecisionKind[]).map((kind) => (
        <RegisterDecision
          key={kind}
          visible={data.canRead}
          family={COMPANY_WALLET_DECISIONS}
          copy={COPY}
          noun="wallet instruction"
          proposal={record}
          kind={kind}
          appointment={data.steps[kind]?.uuid}
          enabled={record.status === 'submitted' && data.instructions.isSuccess && !data.instructions.isFetching}
          newEffectGuard={() => data.guardInstruction(kind, record)}
          readGuard={data.guard}
          epoch={epoch}
          description={`wallet instruction ${record.uuid}`}
          onSettled={() => data.refresh()}
          onRefused={() => data.refresh()}
          onDecided={data.accept}
        >
          {(preview: CompanyWalletDecisionPreview) => (
            <>
              <SnapshotRows snapshot={preview.snapshot} />
              <Rows>
                <Row label="Intent fingerprint">{preview.intentDigest}</Row>
              </Rows>
            </>
          )}
        </RegisterDecision>
      ))}
    </View>
  );
}

function Preparation({ data, visible }: { data: Read; visible: boolean }) {
  const styles = useCompanyStyles();
  const empty = { action: 'add' as 'add' | 'remove', nomination: '', target: '', expiresAt: '' };
  const [state, setState] = useState({ owner: data.owner, scope: data.scopeKey, draft: empty });
  const draft = state.owner === data.owner && state.scope === data.scopeKey ? state.draft : empty;
  const setDraft = (next: typeof empty) => setState({ owner: data.owner, scope: data.scopeKey, draft: next });
  const blocked = data.busy || data.nominations.isFetching || data.targets.isFetching;
  if (!visible) return null;
  return (
    <View style={styles.group}>
      <Choice
        label="Approve a nominated wallet"
        accessibilityRole="radio"
        selected={draft.action === 'add'}
        disabled={blocked}
        onPress={() => setDraft({ action: 'add', nomination: '', target: '', expiresAt: '' })}
      />
      <Choice
        label="Remove a retained company wallet target"
        accessibilityRole="radio"
        selected={draft.action === 'remove'}
        disabled={blocked}
        onPress={() => setDraft({ action: 'remove', nomination: '', target: '', expiresAt: '' })}
      />
      {draft.action === 'add' ? (
        <>
          {data.nominations.data?.map((nomination) => (
            <Choice
              key={nomination.uuid}
              label={`${nomination.address} · ${formatDateTime(nomination.eligibilityExpiresAt)}`}
              accessibilityLabel={`Select shared wallet nomination ${nomination.uuid}`}
              accessibilityRole="radio"
              selected={draft.nomination === nomination.uuid}
              disabled={blocked}
              onPress={() => setDraft({ ...draft, nomination: nomination.uuid, expiresAt: '' })}
            />
          ))}
          <EligibilityExpiry
            label="Wallet approval expiry"
            value={draft.expiresAt}
            disabled={blocked}
            onChange={(expiresAt) => setDraft({ ...draft, expiresAt })}
          />
        </>
      ) : (
        data.targets.data?.map((target) => (
          <Choice
            key={target.uuid}
            label={`${target.address} · ${target.status}`}
            accessibilityLabel={`Select retained wallet target ${target.uuid}`}
            accessibilityRole="radio"
            selected={draft.target === target.uuid}
            disabled={blocked}
            onPress={() => setDraft({ ...draft, target: target.uuid })}
          />
        ))
      )}
      <Text style={styles.muted}>
        Preparation captures the exact company instruction. Review its frozen source, target and technical intent before
        a company decision.
      </Text>
      <Action
        label="Prepare company wallet instruction"
        primary
        disabled={blocked || (draft.action === 'add' ? !draft.nomination || !draft.expiresAt : !draft.target)}
        onPress={() =>
          void data.prepare(
            draft.action === 'add'
              ? { action: 'add', nomination: draft.nomination, expiresAt: draft.expiresAt }
              : { action: 'remove', targetChange: draft.target },
          )
        }
      />
    </View>
  );
}

export function CompanyWalletInstructions() {
  const data = useCompanyWalletInstructions(apiClient, { newKey: Crypto.randomUUID, session: orderSubmissionSession });
  const styles = useCompanyStyles();
  if (!data.owner) return null;
  return (
    <Section title="Company wallet nominations and instructions">
      <Text style={styles.muted}>
        Current personal company administration or a register capability controls these minimal shared-wallet records.
        This access does not expose private eligibility evidence or an account wallet directory.
      </Text>
      {data.companies.map((company) => (
        <Choice
          key={company.uuid}
          label={company.name}
          accessibilityLabel={`Select wallet instruction company ${company.name}`}
          accessibilityRole="radio"
          selected={data.companyUuid === company.uuid}
          disabled={data.busy}
          onPress={() => data.setCompany(company.uuid)}
        />
      ))}
      <Action label="Refresh company wallet instructions" disabled={data.busy} onPress={() => void data.refresh()} />
      {data.original && (
        <View style={styles.group}>
          <Text style={styles.muted}>
            This original preparation is unconfirmed. Its full body and key remain available while current sources are
            unavailable.
          </Text>
          <Rows>
            <Row label="Original instruction key">{data.original.body.operationId}</Row>
            <Row label="Original action">{data.original.body.action}</Row>
          </Rows>
          <Action
            label="Recover original wallet preparation"
            disabled={data.busy}
            onPress={() => void data.recover()}
          />
        </View>
      )}
      {data.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {data.error}
        </Text>
      )}
      {data.companyUuid && data.canRead && (
        <>
          <Text style={styles.heading}>Addresses explicitly shared with this company</Text>
          {data.nominations.data?.map((nomination) => (
            <Rows key={nomination.uuid}>
              <Row label="Nomination">{nomination.uuid}</Row>
              <Row label="Shared address">{nomination.address}</Row>
              <Row label="Chain">{nomination.chain}</Row>
              <Row label="Possession proof completed">{formatDateTime(nomination.proofCompletedAt)}</Row>
              <Row label="Company eligibility expiry">{formatDateTime(nomination.eligibilityExpiresAt)}</Row>
              {nomination.unmetRequirements.map((code) => (
                <Row key={code} label="Current readiness">
                  {COMPANY_WALLET_UNMET_COPY[code] ?? code}
                </Row>
              ))}
            </Rows>
          ))}
          {(data.nominations.isError || data.targets.isError || data.instructions.isError) && (
            <Text accessibilityRole="alert" style={styles.error}>
              Company wallet records could not be refreshed. Retained original instructions remain available for
              recovery.
            </Text>
          )}
        </>
      )}
      {data.companyUuid && (
        <Preparation key={data.scopeKey} data={data} visible={data.canRead && !!data.steps.prepare && !data.original} />
      )}
      {data.retainedRecords.map((record) => (
        <InstructionRecord key={`${data.scopeKey}/${record.uuid}`} record={record} data={data} />
      ))}
    </Section>
  );
}
