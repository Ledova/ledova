import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_COPY,
  formatDate,
  formatShareCount,
  getBlockExplorerAddressUrl,
  getBlockExplorerTxUrl,
  getErrorMessage,
  type CapitalIncreaseStatus,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status, type Tone } from '@components/Ledger';
import { TokenPauseControls } from '../components/TokenPauseControls';
import { ClassRegister } from '../register/ClassRegister';
import { RaiseSharesForm } from './ShareRequestForms';
import { useShareClass } from './useShareClass';
import { DeploymentFlow } from './DeploymentFlow';
import { CompanyIssueFlow } from './CompanyIssueFlow';

function requestTone(status: CapitalIncreaseStatus): Tone {
  if (status === 'executed') return 'done';
  if (status === 'submitted' || status === 'under_review' || status === 'approved' || status === 'executing')
    return 'moving';
  return status === 'draft' ? 'waiting' : 'closed';
}

interface ReadState {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

function ReadResult({ query, label, children }: { query: ReadState; label: string; children: ReactNode }) {
  if (query.isPending)
    return (
      <p role="status" className="py-3 text-sm text-text-muted">
        Loading {label}…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-2 py-3 text-sm text-text-muted">
        <p>We couldn&apos;t load {label}.</p>
        <PageAction label={`Retry ${label}`} onClick={() => void query.refetch()} disabled={query.isFetching} />
      </div>
    );
  return <>{children}</>;
}

export default function ShareClassPage() {
  const { uuid = '' } = useParams();
  return <ShareClass key={uuid} uuid={uuid} />;
}

export function ShareClass({ uuid }: { uuid: string }) {
  const navigate = useNavigate();
  const data = useShareClass(uuid);
  return (
    <Page actions={<PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />}>
      <ShareClassDetails
        key={`${data.tokenKey.join('/')}/${data.token.data?.companyUuid}/${data.token.data?.isOwner === true}`}
        data={data}
      />
      <DeploymentFlow key={`${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`} uuid={uuid} data={data} />
      <CompanyIssueFlow
        key={`issues/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
        uuid={uuid}
        data={data}
      />
    </Page>
  );
}

function ShareClassDetails({ data }: { data: ReturnType<typeof useShareClass> }) {
  const [form, setForm] = useState<{
    kind: 'raise';
    owner: typeof data.owner;
    token: string;
    company: string;
  } | null>(null);
  const [copyError, setCopyError] = useState(false);
  const token = data.token.data;
  const activeForm =
    form?.owner === data.owner && form?.token === token?.uuid && form?.company === token?.companyUuid
      ? form?.kind
      : null;
  const requestForms = data.owner && token?.isOwner && (
    <>
      {activeForm === 'raise' && (
        <RaiseSharesForm
          token={token}
          classRead={data.token}
          guard={() => data.guardOwner('deployed')}
          onClose={() => setForm(null)}
          onSuccess={data.refresh}
        />
      )}
    </>
  );
  const content = () => {
    if (data.token.isPending) return <p role="status">Loading share class…</p>;
    if (data.token.isError || !token)
      return (
        <>
          <div role="alert" className="space-y-3">
            <p className="text-sm text-text-muted">
              This share class could not be loaded. It may be unavailable to this account.
            </p>
            <PageAction label="Try again" onClick={() => void data.token.refetch()} disabled={data.token.isFetching} />
          </div>
        </>
      );
    const deployed = token.status === 'deployed';
    const paused = token.status === 'paused';
    const addressUrl =
      token.chain && token.contractAddress ? getBlockExplorerAddressUrl(token.chain, token.contractAddress) : '';
    const txUrl =
      token.chain && token.deploymentTxHash ? getBlockExplorerTxUrl(token.chain, token.deploymentTxHash) : '';
    const requests = data.requests.data ?? [];
    const capital = data.capital.data ?? [];
    const issuances = data.issuances.data ?? [];
    return (
      <>
        <Section title={token.name}>
          <p className="text-sm text-text-muted">
            {token.companyName} · {token.symbol} · {token.tokenTypeDisplay}
          </p>
          <Rows>
            <Row label="Class state">
              <Status tone={deployed ? 'done' : token.status === 'deploying' ? 'moving' : 'waiting'}>
                {token.statusDisplay}
              </Status>
            </Row>
            <Row label="Authorised shares">
              <span className="break-all">{formatShareCount(token.totalSupply)}</span>
            </Row>
            <Row label="Issued shares">
              <span className="break-all">
                {data.register.isPending
                  ? 'Loading…'
                  : data.register.isError
                    ? 'Unavailable'
                    : data.register.data?.issuedSupply === null
                      ? 'Not recorded'
                      : formatShareCount(data.register.data?.issuedSupply ?? '')}
              </span>
            </Row>
            <Row label="Transferable">{token.isTransferable ? 'Yes' : 'No'}</Row>
            <Row label="Divisible">{token.isDivisible ? 'Yes' : 'No'}</Row>
            <Row label="Decimals">{token.decimals}</Row>
            {token.deployedAt && <Row label="Deployed">{formatDate(token.deployedAt)}</Row>}
          </Rows>
          {token.contractAddress ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-0 break-all text-text-muted">{token.contractAddress}</span>
              {addressUrl && (
                <a href={addressUrl} target="_blank" rel="noopener noreferrer" className="text-brand-light underline">
                  View contract
                </a>
              )}
              <PageAction
                label="Copy contract address"
                onClick={() => {
                  setCopyError(false);
                  void Promise.resolve()
                    .then(() => navigator.clipboard.writeText(token.contractAddress!))
                    .catch(() => setCopyError(true));
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              {token.status === 'deploying'
                ? 'Deployment is in progress. The contract appears after confirmation.'
                : 'This class is not deployed.'}
            </p>
          )}
          {copyError && (
            <p role="alert" className="text-sm text-error-light">
              The address could not be copied.
            </p>
          )}
          {txUrl && (
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-sm text-brand-light underline"
            >
              View deployment transaction
            </a>
          )}
          {data.isOwner && (deployed || paused) && <TokenPauseControls token={token} />}
          {data.isOwner && deployed && (
            <div className="flex flex-wrap gap-2">
              <PageAction
                label="Raise authorised shares"
                onClick={() =>
                  setForm({ kind: 'raise', owner: data.owner, token: token.uuid, company: token.companyUuid })
                }
              />
            </div>
          )}
        </Section>
        <Section title="Register of members">
          <p className="text-sm text-text-muted">{REGISTER_COPY.PRIVACY_NOTE}</p>
          <PageAction
            label={REGISTER_COPY.DOWNLOAD}
            onClick={() => data.download.mutate()}
            disabled={
              data.register.isPending ||
              data.register.isError ||
              !data.register.data?.initialized ||
              data.download.isPending
            }
          />
          {data.download.isError && (
            <p role="alert" className="text-sm text-error-light">
              {REGISTER_COPY.DOWNLOAD_FAILED}
            </p>
          )}
          <ReadResult query={data.register} label="register">
            {data.register.data && <ClassRegister register={data.register.data} />}
          </ReadResult>
        </Section>
        {data.isOwner && (
          <Section title="Issuance requests">
            <ReadResult query={data.requests} label="issuance requests">
              {requests.length === 0 ? (
                <p className="py-3 text-sm text-text-muted">No issuance requests yet.</p>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {requests.map((request) => (
                    <li key={request.uuid} className="space-y-2 py-4 text-sm">
                      <p className="break-words text-text-primary">
                        {formatShareCount(String(request.amount))} {request.tokenSymbol} to {request.recipientAddress}
                      </p>
                      <p className="text-text-muted">{request.reason || request.issuanceTypeDisplay}</p>
                      <p>
                        <Status tone={requestTone(request.status)}>{request.statusDisplay}</Status>
                      </p>
                      <p className="text-xs text-text-muted">{formatDate(request.createdAt)}</p>
                      {request.rejectionReason && <p className="text-text-muted">{request.rejectionReason}</p>}
                      {request.executionNotes && (
                        <details className="text-text-muted">
                          <summary className="cursor-pointer">Execution history</summary>
                          <p className="whitespace-pre-wrap">{request.executionNotes}</p>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ReadResult>
          </Section>
        )}
        {data.isOwner && (
          <Section title="Authorised share requests">
            <p className="text-sm text-text-muted">
              Raising the cap requires staff review and execution. It does not issue shares.
            </p>
            {data.submitCapital.isError && (
              <p role="alert" className="text-sm text-error-light">
                {getErrorMessage(data.submitCapital.error, 'The request could not be submitted. Try again.')}
              </p>
            )}
            <ReadResult query={data.capital} label="authorised share requests">
              {capital.length === 0 ? (
                <p className="py-3 text-sm text-text-muted">No authorised share requests yet.</p>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {capital.map((request) => (
                    <li key={request.uuid} className="space-y-2 py-4 text-sm">
                      <p className="break-words text-text-primary">{request.purpose}</p>
                      <p className="text-text-muted">
                        +{formatShareCount(String(request.additionalShares))} →{' '}
                        {formatShareCount(String(request.newAuthorizedTotal))} authorised shares
                      </p>
                      <p>
                        <Status tone={requestTone(request.status)}>{request.statusDisplay}</Status>
                      </p>
                      <p className="text-xs text-text-muted">{formatDate(request.createdAt)}</p>
                      {request.status === 'draft' && (
                        <PageAction
                          label="Submit for review"
                          onClick={() => data.submitCapital.mutate(request.uuid)}
                          disabled={data.submitCapital.isPending}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ReadResult>
          </Section>
        )}
        {data.isOwner && (
          <Section title="Issuances">
            <ReadResult query={data.issuances} label="issuances">
              {issuances.length === 0 ? (
                <p className="py-3 text-sm text-text-muted">No issuances yet.</p>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {issuances.map((issuance) => (
                    <li key={issuance.uuid} className="space-y-2 py-4 text-sm">
                      <p className="break-words text-text-primary">
                        {formatShareCount(issuance.amount)} shares to {issuance.recipientAddress}
                      </p>
                      <p className="text-text-muted">
                        {issuance.statusDisplay} · {formatDate(issuance.createdAt)}
                      </p>
                      {issuance.subscriptionReference && (
                        <p className="text-text-muted">Application {issuance.subscriptionReference}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ReadResult>
          </Section>
        )}
      </>
    );
  };
  return (
    <>
      {content()}
      {requestForms}
    </>
  );
}
