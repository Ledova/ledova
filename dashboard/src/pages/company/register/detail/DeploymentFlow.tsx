import { Row, Rows, Section, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import {
  REGISTER_DEPLOYMENT_COPY as COPY,
  createUserFriendlyError,
  formatDateTime,
  formatShareCount,
  REGISTER_DEPLOYMENT_DECISIONS,
  REGISTER_DEPLOYMENT_UNMET_COPY,
  registerDeploymentExecutionState,
  type RegisterDeployment,
  type RegisterDeploymentSnapshot,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES } from '@pages/company/shared/proposals';
import { useDeploymentFlow } from './useDeploymentFlow';
import type { useShareClass } from './useShareClass';

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
  const {
    owner,
    guard,
    client,
    key,
    records,
    busy,
    uncertain,
    error,
    retain,
    deployments,
    appointments,
    steps,
    fresh,
    canPrepare,
    guardNewEffect,
    refresh,
    prepare,
  } = useDeploymentFlow({ uuid, data });
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
