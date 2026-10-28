import { Row, Rows, Section, Status, LoadError, Loading, Disclosure } from '@components/Ledger';
import { useCallback, useEffect } from 'react';
import { useEntryReads } from '@hooks/useEntryReads';
import { FormActions, PageAction } from '@components/Page';
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
  refusalSentences,
  COMPANY_STATUS_LABELS,
  DEPLOYMENT_SWAP_APPROVAL_LABELS,
  type CompanyStatus,
  shortReference,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES } from '@pages/company/shared/proposals';
import { useDeploymentFlow } from './useDeploymentFlow';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';

function SnapshotRows({ snapshot }: { snapshot: RegisterDeploymentSnapshot }) {
  const register = snapshot.register;
  return (
    <Rows>
      <Row label="Company">
        {snapshot.company.name} · ACN {snapshot.company.acn}
      </Row>
      <Row label="Company state">{COMPANY_STATUS_LABELS[snapshot.company.status as CompanyStatus]}</Row>
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
        <Disclosure summary="View exact deployment data">
          <p className="break-all">{snapshot.transaction.data}</p>
        </Disclosure>
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
    working,
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
  const onHeldChange = useCallback(
    (uuid: string, held: boolean) => data.holdReads('deployment/decision/' + uuid, held),
    [data.holdReads],
  );
  useEffect(() => {
    data.holdReads('deployment/request', working || uncertain);
    return () => data.holdReads('deployment/request', false);
  }, [working, uncertain, data.holdReads]);
  useEntryReads({
    scope: owner ? data.scopeKey + '/deployment' : null,
    paused: data.readingPaused || working || uncertain,
    refresh,
  });
  if (!owner) return null;
  if (data.token.data?.status !== 'draft' && deployments.isSuccess && !records.length && !uncertain && !error)
    return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {canPrepare && (
        <FormActions>
          <PageAction label={COPY.PREPARE} busy={busy} busyLabel="Preparing…" onClick={() => void prepare()} />
        </FormActions>
      )}
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
      {appointments.isSuccess && !appointments.isFetching && !Object.values(steps).some(Boolean) && (
        <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {appointments.isError && (
        <LoadError retry={refresh} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {deployments.isError && (
        <LoadError
          retry={() => refresh().catch(() => undefined)}
          busy={deployments.isFetching || appointments.isFetching}
        >
          {records.length
            ? 'Deployment history could not be refreshed. Retained receipts remain below.'
            : 'Deployment history could not be loaded.'}
        </LoadError>
      )}
      {!records.length ? (
        !deployments.isError &&
        (deployments.isPending ? (
          <Loading>Loading deployments…</Loading>
        ) : (
          <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
        ))
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
                <Row label="Original preparation">{shortReference(proposal.operationId)}</Row>
                <Row label="Intent digest">{proposal.intentDigest}</Row>
                <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
                {proposal.deploymentId && (
                  <Row label="Admitted deployment">{shortReference(proposal.deploymentId)}</Row>
                )}
                {proposal.approvalDecision && (
                  <Row label="Consumed approval">{shortReference(proposal.approvalDecision)}</Row>
                )}
              </Rows>
              <SnapshotRows snapshot={proposal.snapshot} />
              <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
              {proposal.status === 'applied' && (
                <>
                  <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
                  <Rows>
                    <Row label="Execution">{registerDeploymentExecutionState(proposal)}</Row>
                    {proposal.execution?.operationId && (
                      <Row label="Original execution">{shortReference(proposal.execution.operationId)}</Row>
                    )}
                    {proposal.execution?.txHash && <Row label="Transaction">{proposal.execution.txHash}</Row>}
                    {proposal.execution?.contractAddress && (
                      <Row label="Contract">{proposal.execution.contractAddress}</Row>
                    )}
                    {proposal.execution?.swapApprovalOutcome && (
                      <Row label="Swap approval">
                        {DEPLOYMENT_SWAP_APPROVAL_LABELS[proposal.execution.swapApprovalOutcome]}
                      </Row>
                    )}
                  </Rows>
                  {refusalSentences(proposal.executionUnmetRequirements, REGISTER_DEPLOYMENT_UNMET_COPY).map(
                    (sentence) => (
                      <p key={sentence} className="text-sm text-text-muted">
                        {sentence}
                      </p>
                    ),
                  )}
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
                context={`deployment ${shortReference(proposal.uuid)}`}
                onDecided={async (receipt) => {
                  guard();
                  retain(receipt);
                  await refresh();
                }}
                onRefused={refresh}
                onHeldChange={onHeldChange}
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
