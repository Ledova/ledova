import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_DEPLOYMENT_COPY as COPY,
  REGISTER_DEPLOYMENT_DECISIONS,
  REGISTER_DEPLOYMENT_UNMET_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  formatDateTime,
  failureStatus,
  formatShareCount,
  getOwnCompanyAppointments,
  getRegisterDeployments,
  isPreparedRegisterDeployment,
  prepareRegisterDeployment,
  readEveryPage,
  registerDeploymentExecutionState,
  type RegisterDeployment,
  type RegisterDeploymentPreparation,
  type RegisterDeploymentSnapshot,
  type OwnCompanyAppointment,
  type CompanyShareToken,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from '../register/DecisionTrail';
import { RegisterDecisions } from '../register/RegisterDecisions';
import { registerSteps, STAGE_TONES } from '../register/proposals';
import type { useShareClass } from './useShareClass';
import { ownAppointmentsKey } from '../team/appointments';

function SnapshotRows({ snapshot }: { snapshot: RegisterDeploymentSnapshot }) {
  const register = snapshot.register;
  return (
    <Rows>
      <Row label="Company">
        {snapshot.company.name} · ACN {snapshot.company.acn}
      </Row>
      <Row label="Company state">{snapshot.company.status}</Row>
      <Row label="Share class">
        {snapshot.token.name} · {snapshot.token.symbol} · {snapshot.token.identifier}
      </Row>
      <Row label="Authorised shares">{formatShareCount(snapshot.token.authorisedShares)}</Row>
      <Row label="Decimals">{snapshot.token.decimals}</Row>
      <Row label="Captured issuer address">
        {snapshot.issuerWallet.address} · {snapshot.issuerWallet.chain}
      </Row>
      <Row label="Register">
        {!register.present ? 'Absent' : register.initialized ? 'Opened' : 'Present; not opened'}
      </Row>
      {register.present && (
        <>
          <Row label="Register sequence">{register.sequence ?? 'Unavailable'}</Row>
          <Row label="Register head">{register.headHash || 'No entries'}</Row>
          <Row label="Issued supply">
            {register.issuedSupply === null ? 'Unavailable' : formatShareCount(register.issuedSupply)}
          </Row>
        </>
      )}
      <Row label="Chain ID">{snapshot.transaction.chainId}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
      <Row label="Factory">{snapshot.transaction.to}</Row>
      <Row label="Transaction value">{snapshot.transaction.value}</Row>
      <Row label="Transaction data">
        <details>
          <summary>View exact deployment data</summary>
          <p className="break-all">{snapshot.transaction.data}</p>
        </details>
      </Row>
    </Rows>
  );
}

export function DeploymentFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const { guard, owner, token } = data;
  const client = useQueryClient();
  const company = token.data?.companyUuid;
  const key = [...data.tokenKey, 'deployments'];
  const [records, setRecords] = useState<RegisterDeployment[]>([]);
  const original = useRef<{ request: RegisterDeploymentPreparation; company: string } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retain = (proposal: RegisterDeployment) =>
    setRecords((rows) => [proposal, ...rows.filter((row) => row.uuid !== proposal.uuid)]);
  const deployments = useQuery({
    queryKey: key,
    enabled: !!owner && !!company,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterDeployments(apiClient, { token: uuid, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (
        rows.some(
          (row) =>
            row.token !== uuid ||
            row.company !== company ||
            row.snapshot.token.uuid !== uuid ||
            row.snapshot.company.uuid !== company,
        )
      )
        throw createUserFriendlyError('The deployments do not identify this company and share class.');
      guard();
      setRecords((retained) => [...rows, ...retained.filter((row) => !rows.some((fresh) => fresh.uuid === row.uuid))]);
      return rows;
    },
  });
  const appointmentKey = owner ? ownAppointmentsKey(owner) : ['company', 'appointments', null];
  const appointments = useQuery({
    queryKey: appointmentKey,
    enabled: !!owner,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOwnCompanyAppointments(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const steps =
    appointments.isSuccess && !appointments.isFetching && company ? registerSteps(appointments.data, company) : {};
  const fresh = token.isSuccess && !token.isFetching && token.data.uuid === uuid;
  const canPrepare = fresh && token.data.status === 'draft' && !!steps.prepare && !uncertain;
  const guardNewEffect = (kind: 'prepare' | RegisterDecisionKind) => {
    guard();
    const current = client.getQueryState(data.tokenKey);
    const currentToken = client.getQueryData<CompanyShareToken>(data.tokenKey);
    const source = client.getQueryState(appointmentKey);
    const own = client.getQueryData<OwnCompanyAppointment[]>(appointmentKey);
    const expected = steps[kind]?.uuid;
    const listed = client.getQueryState<RegisterDeployment[]>(key);
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      current.isInvalidated ||
      currentToken?.uuid !== uuid ||
      currentToken.companyUuid !== company ||
      source?.status !== 'success' ||
      source.fetchStatus !== 'idle' ||
      source.isInvalidated ||
      !own ||
      !expected ||
      registerSteps(own, company!)[kind]?.uuid !== expected ||
      (kind === 'prepare' && currentToken.status !== 'draft') ||
      (kind !== 'prepare' && (listed?.status !== 'success' || listed.fetchStatus !== 'idle' || listed.isInvalidated))
    )
      throw createUserFriendlyError('Refresh the share class and your appointment before starting this decision.');
  };
  const refresh = async () => {
    guard();
    await Promise.all([data.refresh(), deployments.refetch(), appointments.refetch()]);
  };
  const prepare = async () => {
    if (pending.current) return;
    let retained = original.current;
    if (!retained) {
      if (!canPrepare || !steps.prepare || !company) return;
      retained = {
        request: { operationId: crypto.randomUUID(), appointment: steps.prepare.uuid, token: uuid },
        company,
      };
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!original.current) guardNewEffect('prepare');
      else guard();
      original.current = retained;
      const recovering = uncertain;
      const response = await prepareRegisterDeployment(apiClient, retained.request, {
        ledovaSubmissionGuard: recovering ? guard : () => guardNewEffect('prepare'),
      });
      guard();
      if (!isPreparedRegisterDeployment(response.data, retained.request, retained.company))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      original.current = null;
      setUncertain(false);
      retain(response.data);
      await refresh();
    } catch (failure) {
      const status = failureStatus(failure);
      if (status === 400 || status === 409) original.current = null;
      setUncertain(!!original.current);
      const codes = (failure as { response?: { data?: { unmetRequirements?: string[] } } }).response?.data
        ?.unmetRequirements;
      setError(
        codes?.length
          ? codes.map((code) => REGISTER_DEPLOYMENT_UNMET_COPY[code] ?? code).join(' ')
          : apiErrorSentence(failure, COPY.PREPARE_FAILED, COPY.PREPARATION_RECEIPT_FAILED),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (!owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {canPrepare && <PageAction label={COPY.PREPARE} disabled={busy} onClick={() => void prepare()} />}
      {uncertain && (
        <>
          <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>
          <PageAction label="Recover preparation receipt" disabled={busy} onClick={() => void prepare()} />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {!Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
      {appointments.isError && (
        <PageAction
          label="Retry deployment appointments"
          onClick={() => void appointments.refetch()}
          disabled={appointments.isFetching}
        />
      )}
      {deployments.isError && (
        <p role="alert" className="text-sm text-error-light">
          Deployment history could not be refreshed. Retained receipts remain below.
        </p>
      )}
      <PageAction
        label="Refresh deployments"
        onClick={() => void refresh().catch(() => undefined)}
        disabled={deployments.isFetching || appointments.isFetching}
      />
      {!records.length ? (
        <p className="text-sm text-text-muted">{deployments.isPending ? 'Loading deployments…' : COPY.EMPTY}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {records.map((proposal) => (
            <li key={proposal.uuid} className="flex flex-col gap-3 py-4">
              <Rows>
                <Row label="Stage">
                  <Status tone={STAGE_TONES[proposal.stage] ?? 'waiting'}>
                    {COPY.STAGES[proposal.stage] ?? proposal.stage}
                  </Status>
                </Row>
                <Row label="Prepared by">
                  {proposal.preparedByName || 'Not recorded'} · {formatDateTime(proposal.createdAt)}
                </Row>
                <Row label="Original preparation">{proposal.operationId}</Row>
                <Row label="Intent digest">{proposal.intentDigest}</Row>
                <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
                {proposal.deploymentId && <Row label="Admitted deployment">{proposal.deploymentId}</Row>}
                {proposal.approvalDecision && <Row label="Consumed approval">{proposal.approvalDecision}</Row>}
              </Rows>
              <SnapshotRows snapshot={proposal.snapshot} />
              <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
              {proposal.status === 'applied' && (
                <>
                  <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
                  <Rows>
                    <Row label="Execution">{registerDeploymentExecutionState(proposal)}</Row>
                    {proposal.execution?.operationId && (
                      <Row label="Original execution">{proposal.execution.operationId}</Row>
                    )}
                    {proposal.execution?.txHash && <Row label="Transaction">{proposal.execution.txHash}</Row>}
                    {proposal.execution?.contractAddress && (
                      <Row label="Contract">{proposal.execution.contractAddress}</Row>
                    )}
                    {proposal.execution?.swapApprovalOutcome && (
                      <Row label="Swap approval">{proposal.execution.swapApprovalOutcome}</Row>
                    )}
                  </Rows>
                  {proposal.executionUnmetRequirements.map((code) => (
                    <p key={code} className="text-sm text-text-muted">
                      {REGISTER_DEPLOYMENT_UNMET_COPY[code] ?? code}
                    </p>
                  ))}
                </>
              )}
              <RegisterDecisions
                family={REGISTER_DEPLOYMENT_DECISIONS}
                copy={COPY}
                noun=""
                proposal={proposal}
                steps={fresh && deployments.isSuccess && !deployments.isFetching ? steps : {}}
                guard={guard}
                newEffectGuard={(kind) => {
                  guardNewEffect(kind);
                  const retained = client
                    .getQueryData<RegisterDeployment[]>(key)
                    ?.find((row) => row.uuid === proposal.uuid);
                  if (
                    retained?.status !== 'submitted' ||
                    retained.company !== proposal.company ||
                    retained.token !== uuid
                  )
                    throw createUserFriendlyError('Refresh the original deployment before starting a new decision.');
                }}
                context={`deployment ${proposal.uuid}`}
                onDecided={async (receipt) => {
                  guard();
                  retain(receipt);
                  await refresh();
                }}
                onRefused={refresh}
              >
                {(preview) => (
                  <>
                    <SnapshotRows snapshot={preview.snapshot} />
                    <Rows>
                      <Row label="Intent digest">{preview.intentDigest}</Row>
                    </Rows>
                  </>
                )}
              </RegisterDecisions>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
