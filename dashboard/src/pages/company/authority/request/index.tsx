import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { DESTINATIONS, failureSentence, useSubmissionOwner, type OrderSubmissionOwner } from '@ledova/shared';
import { LoadError, Loading, Failure } from '@components/Ledger';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useAuthorityRequests } from '@pages/company/authority/shared/useAuthorityRequests';
import { AuthorityRequestRecord } from './AuthorityRequestRecord';
import { AccountCheck } from '@components/AccountCheck';

export default function CompanyAuthorityRequestPage() {
  const { uuid = '' } = useParams();
  const { owner, boundary } = useSubmissionOwner();
  if (!owner)
    return (
      <Page>
        <AccountCheck />
      </Page>
    );
  return (
    <OwnAuthorityRequest
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
      owner={owner}
      currentOwner={boundary.get}
      uuid={uuid}
    />
  );
}

function OwnAuthorityRequest({
  owner,
  currentOwner,
  uuid,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  uuid: string;
}) {
  const { history, lifecycle, opening } = useAuthorityRequests({ owner, currentOwner, readCompanies: false });
  const context = useCompanyContext();
  const back = context?.companyPath(DESTINATIONS.companyAuthority.path) ?? DESTINATIONS.companyAuthority.path;
  const request = history.data?.find((item) => item.uuid === uuid);
  let content: ReactNode;
  if (history.isError)
    content = (
      <LoadError retry={() => history.refetch()} busy={history.isFetching}>
        Your authority requests could not be loaded.
      </LoadError>
    );
  else if (!history.data || (!request && history.isFetching)) content = <Loading>Loading your request…</Loading>;
  else if (!request) content = <p className="text-sm text-text-muted">This authority request is not one of yours.</p>;
  else
    content = (
      <>
        <AuthorityRequestRecord
          request={request}
          blocked={lifecycle.isPending || history.isFetching}
          opening={opening.isPending}
          action={lifecycle.isPending ? lifecycle.variables?.action : undefined}
          onDownload={() => opening.mutate(request)}
          onWithdraw={() => lifecycle.mutateAsync({ request, action: 'withdraw' })}
          onAdmit={() => lifecycle.mutate({ request, action: 'admit' })}
          onRevoke={() => lifecycle.mutateAsync({ request, action: 'revoke' })}
        />
        {opening.isError && (
          <Failure>{failureSentence(opening.error, 'Your evidence could not be downloaded.')}</Failure>
        )}
        {lifecycle.isError && (
          <Failure>
            {failureSentence(lifecycle.error, 'Your request outcome could not be confirmed. Refresh or retry.')}
          </Failure>
        )}
      </>
    );
  return (
    <PageTitle.Provider
      value={request && !history.isError ? request.companyIdentityRaw.name : DESTINATIONS.companyAuthorityRequest.title}
    >
      <Page
        documentTitle={DESTINATIONS.companyAuthorityRequest.title}
        back={{ to: back }}
        lede={request && !history.isError ? `Authority request · ACN ${request.companyIdentityRaw.acn}` : undefined}
      >
        {content}
      </Page>
    </PageTitle.Provider>
  );
}
