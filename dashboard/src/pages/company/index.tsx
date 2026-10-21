import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DESTINATIONS, type Company, useCompanySelection } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { LinkRow, Row, Rows, Section } from '@components/Ledger';
import { CopyButton } from '@components/CopyButton';
import { TOKENS_QUERY_KEY } from '@pages/company/shared/useTokensList';
import { CompanyReadNotice, CompanyStatusMark } from '@pages/company/shared/CompanyState';
import { EditCompanyForm } from './CompanyForms';
import { CompanyDocuments } from './CompanyDocuments';
import { CompanySelection } from '@pages/company/shared/CompanySelection';

export default function CompanyPage() {
  const data = useCompanySelection();
  return <CompanyDetails key={`${data.scopeKey}/${data.companyUuid ?? ''}`} data={data} />;
}

function CompanyDetails({ data }: { data: ReturnType<typeof useCompanySelection> }) {
  const { company } = data;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: data.companyKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: data.companiesKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
    ]);
  const address = company
    ? [
        company.addressLine1,
        company.addressLine2,
        [company.city, company.state, company.postcode].filter(Boolean).join(' '),
        company.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  return (
    <>
      <Page
        narrow
        loading={data.isLoading}
        actions={
          !data.error &&
          data.canAdmin &&
          company && (
            <PageAction label="Edit company" onClick={() => setEditing(company)} disabled={data.isRefreshing} />
          )
        }
      >
        <CompanySelection read={data} />
        {data.error ? (
          <CompanyReadNotice read={data} />
        ) : !company ? (
          <p className="text-sm text-text-muted">Select a company with current administration or owner access.</p>
        ) : (
          <>
            <Section title={company.name}>
              <p className="text-sm text-text-muted">Company information is provided by the company.</p>
              <Rows>
                <Row label="Status">
                  <CompanyStatusMark status={company.status} label={company.statusDisplay} />
                </Row>
                {company.tradingName && (
                  <Row label="Trading name">
                    <span className="break-words">{company.tradingName}</span>
                  </Row>
                )}
                <Row label="Type">{company.companyTypeDisplay}</Row>
                <Row label="ACN">{company.acn}</Row>
                {company.abn && <Row label="ABN">{company.abn}</Row>}
                <Row label="Company UUID">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 break-all">{company.uuid}</span>
                    <CopyButton key={company.uuid} value={company.uuid} label="Copy company UUID" />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">Give this to investors for their eligibility requests.</p>
                </Row>
                {data.canAdmin && company.email && (
                  <Row label="Email">
                    <span className="break-all">{company.email}</span>
                  </Row>
                )}
                {company.phone && <Row label="Phone">{company.phone}</Row>}
                {address && (
                  <Row label="Address">
                    <span className="break-words">{address}</span>
                  </Row>
                )}
              </Rows>
            </Section>
            <Section title="Company administration">
              <div className="divide-y divide-border-subtle">
                {data.ownerBusiness && (
                  <>
                    <LinkRow to={DESTINATIONS.companyAuthority.path} label={DESTINATIONS.companyAuthority.title} />
                  </>
                )}
                <LinkRow to={DESTINATIONS.companyTeam.path} label={DESTINATIONS.companyTeam.title} />
                <LinkRow to={DESTINATIONS.companyEligibility.path} label={DESTINATIONS.companyEligibility.title} />
                {data.ownerBusiness && (
                  <LinkRow to={DESTINATIONS.companyPublications.path} label={DESTINATIONS.companyPublications.title} />
                )}
              </div>
            </Section>
          </>
        )}
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
      {editing && (
        <EditCompanyForm
          key={`${data.scopeKey}/${editing.uuid}`}
          target={editing}
          company={company}
          read={data}
          onClose={() => setEditing(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}
