import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DESTINATIONS, formatShareCount, type Company } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { LinkRow, Row, Rows, Section, Status } from '@components/Ledger';
import { useCompany } from './hooks/useCompany';
import { useTokensList } from './hooks/useTokens';
import { CompanyReadNotice, CompanyStatusMark } from './CompanyState';
import { CreateClassForm, EditCompanyForm } from './CompanyForms';

export default function CompanyPage() {
  const data = useCompany();
  const { company } = data;
  const classes = useTokensList(!data.error && company ? company.uuid : undefined);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState<Company | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['company'] }),
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
      queryClient.invalidateQueries({ queryKey: ['tokens'] }),
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
        loading={data.isLoading}
        actions={
          !data.error &&
          company && (
            <PageAction label="Edit company" onClick={() => setEditing(company)} disabled={data.isRefreshing} />
          )
        }
      >
        {data.error ? (
          <CompanyReadNotice read={data} />
        ) : !company ? (
          <p className="text-sm text-text-muted">No company information available.</p>
        ) : (
          <>
            <Section title="Company details">
              <p className="break-words font-display text-xl text-text-primary">{company.name}</p>
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
                {company.email && (
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
              <div className="divide-y divide-border-subtle">
                <LinkRow to={DESTINATIONS.companyListing.path} label={DESTINATIONS.companyListing.title} />
                <LinkRow to={DESTINATIONS.companyPublications.path} label={DESTINATIONS.companyPublications.title} />
              </div>
            </Section>
            <Section title={classes.isSuccess ? `Share classes (${classes.data.length})` : 'Share classes'}>
              {classes.isPending ? (
                <p role="status" className="text-sm text-text-muted">
                  Loading share classes…
                </p>
              ) : classes.isError ? (
                <div role="alert" className="space-y-2 text-sm text-text-muted">
                  <p>Share classes could not be loaded.</p>
                  <PageAction
                    label="Retry share classes"
                    onClick={() => void classes.refetch()}
                    disabled={classes.isFetching}
                  />
                </div>
              ) : (classes.data ?? []).length === 0 ? (
                <p className="text-sm text-text-muted">No share classes yet.</p>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {classes.data!.map((token) => (
                    <LinkRow
                      key={token.uuid}
                      to={DESTINATIONS.companyClass.path.replace(':uuid', token.uuid)}
                      label={token.name}
                      aside={
                        <Status
                          tone={
                            token.status === 'deployed' ? 'done' : token.status === 'deploying' ? 'moving' : 'waiting'
                          }
                        >
                          {token.statusDisplay}
                        </Status>
                      }
                    >
                      <p className="text-text-muted">
                        {token.symbol} · {token.tokenTypeDisplay}
                      </p>
                      <p className="break-all text-text-muted">
                        {formatShareCount(token.totalSupply)} authorised shares
                      </p>
                    </LinkRow>
                  ))}
                  <LinkRow to={DESTINATIONS.companyRegister.path} label={DESTINATIONS.companyRegister.title} />
                </div>
              )}
              <PageAction
                label="Create share class"
                onClick={() => setCreating(company)}
                disabled={data.isRefreshing}
              />
            </Section>
          </>
        )}
      </Page>
      {editing && (
        <EditCompanyForm
          target={editing}
          company={company}
          read={data}
          onClose={() => setEditing(null)}
          onSuccess={refresh}
        />
      )}
      {creating && (
        <CreateClassForm
          target={creating}
          company={company}
          read={data}
          onClose={() => setCreating(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}
