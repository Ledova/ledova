import { useParams } from 'react-router-dom';
import { Page } from '@components/Page';
import { LoadError, Loading } from '@components/Ledger';
import { PreparationNotice } from '@pages/company/ledger/shared/PreparationShell';
import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { useShareClass } from '@pages/company/ledger/shared/useShareClass';
import { classPath } from '@pages/company/ledger/shared/registerPlace';
import { ChainHistory } from './ChainHistory';
import { CompanyCapitalFlow } from './CompanyCapitalFlow';
import { CompanyIssueFlow } from './CompanyIssueFlow';
import { CompanyPauseFlow } from './CompanyPauseFlow';
import { DeploymentFlow } from './DeploymentFlow';

export default function CompanyClassChainPage() {
  const { uuid = '' } = useParams();
  return <ClassChain key={uuid} uuid={uuid} />;
}

function ClassChain({ uuid }: { uuid: string }) {
  const data = useShareClass(uuid);
  const company = data.token.data?.companyUuid;
  const companyMatches = useRecordCompany(company, data.guard);
  if (!companyMatches)
    return (
      <Page back={{ to: classPath('companyClass', uuid) }}>
        <PreparationNotice />
      </Page>
    );
  const token = data.token.data;
  const owner = `${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`;
  const onChain = token?.status === 'deployed' || token?.status === 'paused';
  return (
    <Page
      back={{ to: classPath('companyClass', uuid, company) }}
      lede={token ? `${token.name} · ${token.symbol}` : undefined}
    >
      {data.token.isPending ? (
        <Loading>Loading the share class…</Loading>
      ) : data.token.isError || !token ? (
        <LoadError retry={data.token.refetch} busy={data.token.isFetching}>
          This share class could not be loaded. It may be unavailable to this account.
        </LoadError>
      ) : (
        <>
          {onChain && (
            <>
              <CompanyIssueFlow key={`issues/${owner}`} uuid={uuid} data={data} />
              <CompanyCapitalFlow key={`capital/${owner}`} uuid={uuid} data={data} />
              <CompanyPauseFlow key={`pause/${uuid}/${owner}`} uuid={uuid} data={data} />
            </>
          )}
          <DeploymentFlow key={owner} uuid={uuid} data={data} />
          {token.status !== 'draft' && <ChainHistory uuid={uuid} data={data} />}
        </>
      )}
    </Page>
  );
}
