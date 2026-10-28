import { useQueryClient } from '@tanstack/react-query';
import { useCompanySelection } from '@ledova/shared';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { CompanyReadNotice } from '@components/CompanyState';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { TOKENS_QUERY_KEY } from '@hooks/useTokensList';
import { CompanyDocuments } from './CompanyDocuments';

export default function CompanyDocumentsPage() {
  const context = useCompanyContext();
  const data = useCompanySelection({ selectedUuid: context ? (context.companyUuid ?? '') : undefined });
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
    <PageTitle.Provider value="Company documents">
      <Page loading={data.isLoading}>
        {data.error ? <CompanyReadNotice read={data} /> : !data.company ? <CompanyContextNotice /> : null}
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
