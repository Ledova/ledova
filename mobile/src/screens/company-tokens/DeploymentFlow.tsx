import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  appointmentForRegisterStep,
  failureStatus,
  formatDateTime,
  formatShareCount,
  getErrorMessage,
  getOwnCompanyAppointments,
  getRegisterDeployments,
  isPreparedRegisterDeployment,
  prepareRegisterDeployment,
  readEveryPage,
  registerDeploymentExecutionState,
  REGISTER_DEPLOYMENT_COPY as COPY,
  REGISTER_DEPLOYMENT_DECISIONS,
  REGISTER_DEPLOYMENT_UNMET_COPY,
  type CompanyShareToken,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterDeployment,
  type RegisterDeploymentDecisionPreview,
  type RegisterDeploymentPreparation,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterDecision } from '../company-register/RegisterDecision';
import { useCompanyStyles } from '../company-register/styles';
import type { useTokenDetail } from './useTokenDetail';

type Read = ReturnType<typeof useTokenDetail>;
type Snapshot = RegisterDeployment['snapshot'];

function SnapshotRows({ snapshot }: { snapshot: Snapshot }) {
  const styles = useCompanyStyles();
  const register = snapshot.register;
  const registerState = !register.present
    ? 'Absent'
    : register.initialized === true
      ? 'Opened'
      : register.initialized === false
        ? 'Present, unopened'
        : 'Unavailable';
  return (
    <Rows>
      <Row label="Company">{snapshot.company.name}</Row>
      <Row label="ACN">{snapshot.company.acn}</Row>
      <Row label="Company state">{snapshot.company.status}</Row>
      <Row label="Share class">
        {snapshot.token.name} · {snapshot.token.symbol}
      </Row>
      <Row label="Class identifier">{snapshot.token.identifier}</Row>
      <Row label="Authorised shares">{formatShareCount(snapshot.token.authorisedShares)}</Row>
      <Row label="Decimals">{snapshot.token.decimals}</Row>
      <Row label="Register state">{registerState}</Row>
      <Row label="Register sequence">{register.sequence ?? 'Not recorded'}</Row>
      <Row label="Issued shares">
        {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
      </Row>
      <Row label="Register head">{register.headHash ?? 'Not recorded'}</Row>
      <Row label="Captured issuer wallet">
        <Text selectable style={styles.text}>
          {snapshot.issuerWallet.address}
        </Text>
      </Row>
      <Row label="Wallet chain">{snapshot.issuerWallet.chain}</Row>
      <Row label="Chain ID">{snapshot.transaction.chainId}</Row>
      <Row label="Factory">
        <Text selectable style={styles.text}>
          {snapshot.transaction.to}
        </Text>
      </Row>
      <Row label="Technical sender">
        <Text selectable style={styles.text}>
          {snapshot.transaction.sender}
        </Text>
      </Row>
      <Row label="Transaction value">{snapshot.transaction.value}</Row>
      <Row label="Transaction data">
        <Text selectable style={styles.text}>
          {snapshot.transaction.data}
        </Text>
      </Row>
    </Rows>
  );
}

function DeploymentRecord({
  proposal,
  data,
  steps,
  enabled,
  assertDecision,
  onSettled,
}: {
  proposal: RegisterDeployment;
  data: Read;
  steps: Partial<Record<RegisterDecisionKind, OwnCompanyAppointment>>;
  enabled: boolean;
  assertDecision: (proposal: RegisterDeployment, kind: RegisterDecisionKind, appointment?: string) => void;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const execution = proposal.execution;
  const description = `deployment ${proposal.uuid}, prepared ${formatDateTime(proposal.createdAt)}`;
  const state = registerDeploymentExecutionState(proposal);
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>{COPY.STAGES[proposal.stage] ?? proposal.stage}</Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <SnapshotRows snapshot={proposal.snapshot} />
      <Rows>
        <Row label="Preparation ID">{proposal.uuid}</Row>
        <Row label="Prepared by">{proposal.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        <Row label="Intent fingerprint">{proposal.intentDigest}</Row>
        {proposal.decisions.map((decision) => (
          <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
            {!!decision.reason && ` · ${decision.reason}`}
          </Row>
        ))}
        {!!proposal.rejectionReason && <Row label="Rejection reason">{proposal.rejectionReason}</Row>}
        {!!proposal.approvalDecision && <Row label="Consumed approval">{proposal.approvalDecision}</Row>}
        {!!proposal.deploymentId && <Row label="Original deployment">{proposal.deploymentId}</Row>}
        <Row label="Execution">{state}</Row>
        {!!execution?.operationId && <Row label="Execution operation">{execution.operationId}</Row>}
        {!!execution?.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
        {!!execution?.contractAddress && <Row label="Original contract">{execution.contractAddress}</Row>}
        {!!execution?.swapApprovalOutcome && <Row label="Swap approval">{execution.swapApprovalOutcome}</Row>}
      </Rows>
      {proposal.deploymentId && <Text style={styles.muted}>{COPY.ADMITTED_NOTE}</Text>}
      {proposal.executionUnmetRequirements.map((code) => (
        <Text key={code} style={styles.muted}>
          {REGISTER_DEPLOYMENT_UNMET_COPY[code] ?? code}
        </Text>
      ))}
      <View style={styles.choices}>
        {(['approve', 'apply', 'reject'] as RegisterDecisionKind[]).map((kind) => (
          <RegisterDecision
            key={kind}
            family={REGISTER_DEPLOYMENT_DECISIONS}
            copy={COPY}
            noun="deployment"
            proposal={proposal}
            kind={kind}
            appointment={steps[kind]?.uuid}
            enabled={enabled && proposal.status === 'submitted' && !data.token.isFetching && !data.token.isError}
            newEffectGuard={() => assertDecision(proposal, kind, steps[kind]?.uuid)}
            epoch={data.epoch}
            description={description}
            onSettled={onSettled}
            onRefused={onSettled}
          >
            {(preview: RegisterDeploymentDecisionPreview) => (
              <>
                <SnapshotRows snapshot={preview.snapshot} />
                <Rows>
                  <Row label="Intent fingerprint">{preview.intentDigest}</Row>
                </Rows>
                <Text style={styles.muted}>{COPY.ADMITTED_NOTE}</Text>
              </>
            )}
          </RegisterDecision>
        ))}
      </View>
    </View>
  );
}

export function DeploymentFlow({ uuid, data }: { uuid: string; data: Read }) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const mounted = useRef(true);
  const pending = useRef(false);
  const company = data.token.data?.uuid === uuid ? data.token.data.companyUuid : undefined;
  const scope = [data.epoch, data.owner?.userUuid, data.owner?.ownerAccountUuid, uuid];
  const appointmentsKey = ['register-deployment-appointments', ...scope];
  const proposalsKey = ['register-deployments', ...scope];
  const guard = () => {
    data.guard();
    if (!mounted.current) throw new Error('This deployment is no longer open.');
  };
  const config = (signal?: AbortSignal) => ({ signal, ledovaSessionEpoch: data.epoch, ledovaSubmissionGuard: guard });
  const read = async <Result,>(request: () => Promise<Result>) => {
    guard();
    const result = await request();
    guard();
    return result;
  };
  const appointments = useQuery({
    queryKey: appointmentsKey,
    enabled: !!data.owner && !!company,
    queryFn: ({ signal }) =>
      readEveryPage((page) => read(() => getOwnCompanyAppointments(apiClient, page, config(signal)))),
  });
  const steps = Object.fromEntries(
    (['prepare', 'approve', 'apply', 'reject'] as const).map((kind) => [
      kind,
      appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company!, kind) : undefined,
    ]),
  );
  const [records, setRecords] = useState<RegisterDeployment[]>([]);
  const proposals = useQuery({
    queryKey: proposalsKey,
    enabled: !!data.owner && !!company,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage((page) =>
        read(() => getRegisterDeployments(apiClient, { token: uuid, page }, config(signal))),
      );
      if (
        rows.some((row) => row.token !== uuid || row.company !== company) ||
        new Set(rows.map((row) => row.uuid)).size !== rows.length
      )
        throw new Error('The deployment records do not belong to this share class.');
      return rows;
    },
  });
  const retain = (proposal: RegisterDeployment) =>
    setRecords((previous) => [proposal, ...previous.filter((row) => row.uuid !== proposal.uuid)]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (proposals.isSuccess)
      setRecords((previous) => [
        ...proposals.data,
        ...previous.filter((row) => !proposals.data.some((listed) => listed.uuid === row.uuid)),
      ]);
  }, [proposals.data, proposals.isSuccess]);
  const [original, setOriginal] = useState<{ request: RegisterDeploymentPreparation; company: string } | null>(null);
  const originalRef = useRef<typeof original>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = data.refresh;
  const assertPreparation = (request: RegisterDeploymentPreparation, exactCompany: string) => {
    guard();
    const current = client.getQueryState<CompanyShareToken>(data.tokenKey);
    const sources = client.getQueryState<OwnCompanyAppointment[]>(appointmentsKey);
    const source = sources?.data && appointmentForRegisterStep(sources.data, exactCompany, 'prepare');
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      current.isInvalidated ||
      current.data?.uuid !== uuid ||
      current.data.companyUuid !== exactCompany ||
      current.data.status !== 'draft' ||
      sources?.status !== 'success' ||
      sources.fetchStatus !== 'idle' ||
      sources.isInvalidated ||
      source?.uuid !== request.appointment
    )
      throw new Error('Refresh this class and its current preparation appointment before preparing deployment.');
  };
  const assertDecision = (proposal: RegisterDeployment, kind: RegisterDecisionKind, appointment?: string) => {
    guard();
    const current = client.getQueryState<CompanyShareToken>(data.tokenKey);
    const sources = client.getQueryState<OwnCompanyAppointment[]>(appointmentsKey);
    const listed = client.getQueryState<RegisterDeployment[]>(proposalsKey);
    const source = sources?.data && appointmentForRegisterStep(sources.data, proposal.company, kind);
    const retained = listed?.data?.find((row) => row.uuid === proposal.uuid);
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      current.isInvalidated ||
      current.data?.uuid !== uuid ||
      current.data.companyUuid !== proposal.company ||
      sources?.status !== 'success' ||
      sources.fetchStatus !== 'idle' ||
      sources.isInvalidated ||
      !appointment ||
      source?.uuid !== appointment ||
      listed?.status !== 'success' ||
      listed.fetchStatus !== 'idle' ||
      listed.isInvalidated ||
      retained?.status !== 'submitted' ||
      retained.company !== proposal.company ||
      retained.token !== uuid
    )
      throw new Error('Refresh this class, deployment and current appointment before a new decision.');
  };
  const prepare = async (recover = false) => {
    if (pending.current) return;
    const retained = originalRef.current;
    if (recover && !retained) return;
    if (!recover && (retained || !steps.prepare || !company)) return;
    const operation = retained ?? {
      request: { operationId: Crypto.randomUUID(), appointment: steps.prepare!.uuid, token: uuid },
      company: company!,
    };
    pending.current = true;
    setSending(true);
    setError(null);
    try {
      guard();
      if (!recover) assertPreparation(operation.request, operation.company);
      originalRef.current = operation;
      setOriginal(operation);
      const response = await prepareRegisterDeployment(apiClient, operation.request, {
        ...config(),
        ledovaSubmissionGuard: recover ? guard : () => assertPreparation(operation.request, operation.company),
      });
      guard();
      if (!isPreparedRegisterDeployment(response.data, operation.request, operation.company))
        throw new Error(COPY.PREPARATION_RECEIPT_FAILED);
      retain(response.data);
      originalRef.current = null;
      setOriginal(null);
      await settle();
    } catch (failure) {
      if (mounted.current) {
        const status = failureStatus(failure);
        if (status === 400 || status === 409) {
          originalRef.current = null;
          setOriginal(null);
        }
        setError(getErrorMessage(failure, COPY.PREPARE_FAILED));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setSending(false);
    }
  };
  if (!data.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      {proposals.isSuccess && (
        <Action
          label="Refresh deployment records"
          disabled={proposals.isFetching || appointments.isFetching}
          onPress={() => void settle()}
        />
      )}
      {steps.prepare && data.token.isSuccess && data.token.data?.status === 'draft' && !original && (
        <Action
          label={COPY.PREPARE}
          disabled={sending || data.token.isFetching || appointments.isFetching}
          onPress={() => void prepare()}
        />
      )}
      {original && (
        <View style={styles.group}>
          <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>
          <Text selectable style={styles.text}>
            {original.request.operationId}
          </Text>
          <Action label="Recover preparation receipt" disabled={sending} onPress={() => void prepare(true)} />
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {proposals.isPending && <Text style={styles.muted}>Loading deployment records…</Text>}
      {proposals.isError && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The deployment records could not be refreshed. Original requests remain available for recovery.
          </Text>
          <Action
            label="Retry deployment records"
            disabled={proposals.isFetching}
            onPress={() => void proposals.refetch()}
          />
        </View>
      )}
      {appointments.isError && (
        <Action
          label="Retry deployment appointments"
          disabled={appointments.isFetching}
          onPress={() => void appointments.refetch()}
        />
      )}
      {proposals.isSuccess && records.length === 0 && <Text style={styles.muted}>{COPY.EMPTY}</Text>}
      {records.map((proposal) => (
        <DeploymentRecord
          key={proposal.uuid}
          proposal={proposal}
          data={data}
          steps={steps}
          enabled={proposals.isSuccess && !proposals.isFetching && appointments.isSuccess && !appointments.isFetching}
          assertDecision={assertDecision}
          onSettled={settle}
        />
      ))}
    </Section>
  );
}
