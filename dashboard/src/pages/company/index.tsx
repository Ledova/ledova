import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DESTINATIONS, useCompanySelection } from '@ledova/shared';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { CompanyReadNotice } from '@components/CompanyState';
import { CompanySelection } from '@components/CompanySelection';
import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { TOKENS_QUERY_KEY } from '@hooks/useTokensList';
import { CompanyDocuments } from './CompanyDocuments';

export default function CompanyPage() {
  const { hash, search, state } = useLocation();
  if (hash !== '#documents')
    return <Navigate to={{ pathname: DESTINATIONS.settings.path, search, hash: '#profile' }} state={state} replace />;
  return <DocumentsPage />;
}

function DocumentsPage() {
  const data = useCompanySelection();
  return <Documents key={`${data.scopeKey}/${data.companyUuid ?? ''}`} data={data} />;
}

function Documents({ data }: { data: ReturnType<typeof useCompanySelection> }) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: data.companyKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: data.companiesKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
    ]);
  return (
    <PageTitle.Provider value="Documents">
      <Page loading={data.isLoading}>
        <CompanySelection read={data} />
        {data.error ? (
          <CompanyReadNotice read={data} />
        ) : !data.company ? (
          <p className="text-sm text-text-muted">Select a company with current administration or owner access.</p>
        ) : null}
        {data.retainedCompany && (
          <CompanyDocuments
            key={`${data.scopeKey}/${data.retainedCompany.uuid}`}
            company={data.retainedCompany}
            read={data}
            editable={data.canAdmin}
            refresh={refresh}
          />
        )}
      </Page>
    </PageTitle.Provider>
  );
}
