import { Row, Rows, Section, LoadError, Loading } from '@components/Ledger';
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
  DEPLOYMENT_SWAP_APPROVAL_LABELS,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RecordShell, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { useDeploymentFlow } from './useDeploymentFlow';
import { TransactionRow } from './TransactionRow';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';

function DeploymentRows({ snapshot }: { snapshot: RegisterDeploymentSnapshot }) {
  const register = snapshot.register;
  return (
    <>
      <Row label="Authorised shares">{formatShareCount(snapshot.token.authorisedShares)}</Row>
      <Row label="Issuer wallet">
        <span className="break-all">{snapshot.issuerWallet.address}</span>
      </Row>
      <Row label="Ledger">
        {!register.present ? 'Not set up' : register.initialized ? 'Opened' : 'Set up, not opened'}
      </Row>
      {register.present && (
        <Row label="Issued shares">
          {register.issuedSupply === null ? 'Unavailable' : formatShareCount(register.issuedSupply)}
        </Row>
      )}
    </>
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
  const token = data.token.data;
  const onChain = token?.status === 'deployed' || token?.status === 'paused';
  if (onChain && deployments.isSuccess && !records.length && !uncertain && !error) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
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
        <>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <ul className="divide-y divide-border-subtle">
            {records.map((proposal) => {
              const context = `deployment prepared ${formatDateTime(proposal.createdAt)}`;
              const applied = proposal.status === 'applied';
              return (
                <RecordShell key={proposal.uuid}>
                  <Rows>
                    <RecordStage stage={proposal.stage}>{COPY.STAGES[proposal.stage] ?? proposal.stage}</RecordStage>
                    <DeploymentRows snapshot={proposal.snapshot} />
                    <Row label="Prepared by">{proposal.preparedByName || 'Not recorded'}</Row>
                    <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
                    <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
                    {applied && (
                      <>
                        <Row label="Execution">{registerDeploymentExecutionState(proposal)}</Row>
                        {proposal.execution?.txHash && (
                          <TransactionRow
                            chain={proposal.snapshot.issuerWallet.chain}
                            hash={proposal.execution.txHash}
                          />
                        )}
                        {proposal.execution?.contractAddress && (
                          <Row label="Contract">
                            <span className="break-all">{proposal.execution.contractAddress}</span>
                          </Row>
                        )}
                        {proposal.execution?.swapApprovalOutcome && (
                          <Row label="Swap approval">
                            {DEPLOYMENT_SWAP_APPROVAL_LABELS[proposal.execution.swapApprovalOutcome]}
                          </Row>
                        )}
                      </>
                    )}
                  </Rows>
                  {applied && (
                    <>
                      <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
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
                        throw createUserFriendlyError(
                          'Refresh the original deployment before starting a new decision.',
                        );
                    }}
                    context={context}
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
                        <p className="text-sm text-text-muted">
                          {preview.snapshot.token.name} · {preview.snapshot.token.symbol}
                        </p>
                        <Rows>
                          <DeploymentRows snapshot={preview.snapshot} />
                        </Rows>
                      </>
                    )}
                  </RegisterDecisions>
                </RecordShell>
              );
            })}
          </ul>
        </>
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
      {canPrepare && (
        <FormActions>
          <PageAction primary label={COPY.PREPARE} busy={busy} busyLabel="Preparing…" onClick={() => void prepare()} />
        </FormActions>
      )}
    </Section>
  );
}
