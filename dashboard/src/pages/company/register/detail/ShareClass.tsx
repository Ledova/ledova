import { requestTone, SHARE_CLASS_STATUS_TONES } from '@pages/company/shared/statusTones';
import { CompanyPaidIssueFlow } from './CompanyPaidIssueFlow';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  formatDate,
  formatShareCount,
  getBlockExplorerAddressUrl,
  getBlockExplorerTxUrl,
  useUserPreferences,
  shareCount,
} from '@ledova/shared';
import { Page, PageAction, PageLink } from '@components/Page';
import { Row, Rows, Section, Status, LoadError, Loading } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { ClassRegister } from '@pages/company/register/shared/ClassRegister';
import { CompanyShareholders } from '@pages/company/register/shared/CompanyShareholders';
import { useShareClass } from './useShareClass';
import { DeploymentFlow } from './DeploymentFlow';
import { CompanyIssueFlow } from './CompanyIssueFlow';
import { CompanyCapitalFlow } from './CompanyCapitalFlow';
import { CompanyPauseFlow } from './CompanyPauseFlow';

interface ReadState {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

function ReadResult({ query, label, children }: { query: ReadState; label: string; children: ReactNode }) {
  if (query.isPending) return <Loading>Loading {label}…</Loading>;
  if (query.isError)
    return (
      <LoadError retry={query.refetch} busy={query.isFetching}>
        {label.charAt(0).toUpperCase() + label.slice(1)} could not be loaded.
      </LoadError>
    );
  return <>{children}</>;
}

export function ShareClass({ uuid }: { uuid: string }) {
  const data = useShareClass(uuid);
  return (
    <Page narrow actions={<PageLink to={DESTINATIONS.companyRegister.path} label="Back to Register" />}>
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
      <CompanyCapitalFlow
        key={`capital/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
        uuid={uuid}
        data={data}
      />
      <CompanyPaidIssueFlow
        key={`paid-issue/${uuid}/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
        uuid={uuid}
        data={data}
      />
      <CompanyPauseFlow
        key={`pause/${uuid}/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
        uuid={uuid}
        data={data}
      />
    </Page>
  );
}

function ShareClassDetails({ data }: { data: ReturnType<typeof useShareClass> }) {
  const [copyError, setCopyError] = useState(false);
  const preferences = useUserPreferences();
  const preferencesRead = useQueryClient().getQueryState(USER_PREFERENCES_QUERY_KEY);
  const registerReady =
    !!preferences.preferences &&
    preferencesRead?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.token.isSuccess &&
    data.token.fetchStatus === 'idle' &&
    data.register.isSuccess &&
    data.register.fetchStatus === 'idle';
  const token = data.token.data;
  const content = () => {
    if (data.token.isPending) return <Loading>Loading the share class…</Loading>;
    if (data.token.isError || !token)
      return (
        <LoadError retry={data.token.refetch} busy={data.token.isFetching}>
          This share class could not be loaded. It may be unavailable to this account.
        </LoadError>
      );
    const addressUrl =
      token.chain && token.contractAddress ? getBlockExplorerAddressUrl(token.chain, token.contractAddress) : '';
    const txUrl =
      token.chain && token.deploymentTxHash ? getBlockExplorerTxUrl(token.chain, token.deploymentTxHash) : '';
    const requests = data.requests.rows;
    const capital = data.capital.rows;
    const issuances = data.issuances.rows;
    return (
      <>
        <Section title={token.name}>
          <p className="text-sm text-text-muted">
            {token.companyName} · {token.symbol} · {token.tokenTypeDisplay}
          </p>
          <Rows>
            <Row label="Class state">
              <Status tone={SHARE_CLASS_STATUS_TONES.get(token.status) ?? 'waiting'}>{token.statusDisplay}</Status>
            </Row>
            <Row label="Technical share limit">
              {token.totalSupply !== TECHNICAL_SHARE_LIMIT ? (
                <span className="break-all">{formatShareCount(token.totalSupply)}</span>
              ) : (
                <details>
                  <summary className="cursor-pointer">{REGISTER_COPY.QUANTITY_GUARD}</summary>
                  <span className="break-all">{formatShareCount(token.totalSupply)}</span>
                </details>
              )}
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
        </Section>
        <Section title="Register of members">
          <p className="text-sm text-text-muted">{REGISTER_COPY.PRIVACY_NOTE}</p>
          <PageAction
            label={REGISTER_COPY.DOWNLOAD}
            busy={data.download.isPending}
            busyLabel="Downloading…"
            onClick={() => data.download.mutate()}
            disabled={data.register.isPending || data.register.isError || !data.register.data?.initialized}
          />
          {data.download.isError && (
            <p role="alert" className="text-sm text-error-light">
              {REGISTER_COPY.DOWNLOAD_FAILED}
            </p>
          )}
          <ReadResult query={data.register} label="the register">
            {registerReady && data.register.data && <ClassRegister register={data.register.data} />}
          </ReadResult>
        </Section>
        {registerReady && data.register.data && (
          <CompanyShareholders registers={[data.register.data]} company={token.companyUuid} />
        )}
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
              <LoadMore noun={['issuance request', 'issuance requests']} {...data.requests.more} />
            </ReadResult>
          </Section>
        )}
        {data.isOwner && (
          <Section title="Authorised share requests">
            <p className="text-sm text-text-muted">
              Retained original capital request history. New increases use the company workflow below.
            </p>
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
                    </li>
                  ))}
                </ul>
              )}
              <LoadMore noun={['authorised share request', 'authorised share requests']} {...data.capital.more} />
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
                        {shareCount(issuance.amount)} to {issuance.recipientAddress}
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
              <LoadMore noun={['issuance', 'issuances']} {...data.issuances.more} />
            </ReadResult>
          </Section>
        )}
      </>
    );
  };
  return content();
}
