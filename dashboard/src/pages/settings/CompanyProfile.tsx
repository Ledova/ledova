import { useCompanyContext } from '@hooks/useCompanyContext';
import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Company, useCompanySelection } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { Disclosure, Row, Rows, Section, Loading } from '@components/Ledger';
import { CopyButton } from '@components/CopyButton';
import { TOKENS_QUERY_KEY } from '@hooks/useTokensList';
import { CompanyReadNotice, CompanyStatusMark } from '@components/CompanyState';
import { EditCompanyForm } from './CompanyForms';
import { CompanyContextNotice } from '@components/CompanyContextNotice';

export function CompanyProfile() {
  const context = useCompanyContext();
  const data = useCompanySelection({ selectedUuid: context ? (context.companyUuid ?? '') : undefined });
  return <CompanyDetails key={`${data.scopeKey}/${data.companyUuid ?? ''}`} data={data} />;
}

function CompanyDetails({ data }: { data: ReturnType<typeof useCompanySelection> }) {
  const { company } = data;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const editAction = useRef<HTMLButtonElement>(null);
  const closeEdit = () => {
    setEditing(null);
    requestAnimationFrame(() => editAction.current?.focus());
  };
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: data.companyKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: data.companiesKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['member-records'] }),
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
    <Section title="Company details">
      {data.isLoading ? (
        <Loading>Loading company details…</Loading>
      ) : (
        <>
          {editing ? (
            <EditCompanyForm
              key={`${data.scopeKey}/${editing.uuid}`}
              target={editing}
              canShareOwnership={data.canPersonalAdmin}
              company={company}
              read={data}
              onClose={closeEdit}
              onSuccess={refresh}
            />
          ) : data.error ? (
            <CompanyReadNotice read={data} />
          ) : !company ? (
            <CompanyContextNotice />
          ) : (
            <>
              <Rows>
                <Row label="Company name">
                  <span className="break-words">{company.name}</span>
                </Row>
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
                <Row label="Member ownership overview">{company.shareOwnershipWithMembers ? 'Shared' : 'Private'}</Row>
                {company.abn && <Row label="ABN">{company.abn}</Row>}
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
              <Disclosure summary="Record details">
                <p className="text-sm text-text-muted">Company information is provided by the company.</p>
                <Rows>
                  <Row label="Company UUID">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 break-all">{company.uuid}</span>
                      <CopyButton key={company.uuid} value={company.uuid} label="Copy company UUID" />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      Give this to investors for their eligibility requests and claims.
                    </p>
                  </Row>
                </Rows>
              </Disclosure>
              {data.canAdmin && (
                <FormActions>
                  <PageAction
                    ref={editAction}
                    label="Edit company"
                    onClick={() => setEditing(company)}
                    disabled={data.isRefreshing}
                  />
                </FormActions>
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}
