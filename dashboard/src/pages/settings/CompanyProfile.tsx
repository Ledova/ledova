import { useCompanyContext } from '@hooks/useCompanyContext';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  type Company,
  DESTINATIONS,
  failureSentence,
  ownCompaniesKey,
  useCompanyDeletion,
  useCompanySelection,
  REGISTER_QUERY_KEY,
} from '@ledova/shared';
import { Modal } from '@components/Modal';
import { Actions, PageAction } from '@components/Page';
import { Row, Rows, Section, Loading } from '@components/Ledger';
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
  const [deleting, setDeleting] = useState(false);
  const editAction = useRef<HTMLButtonElement>(null);
  const closeEdit = () => {
    setEditing(null);
    requestAnimationFrame(() => editAction.current?.focus());
  };
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: data.companyKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: ownCompaniesKey(data.owner) }),
      queryClient.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['member-records'] }),
    ]);
  const street = company
    ? [
        company.addressLine1,
        company.addressLine2,
        [company.city, company.state, company.postcode].filter(Boolean).join(' '),
      ].filter(Boolean)
    : [];
  const address = street.length ? [...street, company?.country].filter(Boolean).join(', ') : '';
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
                <Row label="Company name" inline>
                  <span className="break-words">{company.name}</span>
                </Row>
                <Row label="Status" inline>
                  <CompanyStatusMark status={company.status} label={company.statusDisplay} />
                </Row>
                {company.tradingName && (
                  <Row label="Trading name" inline>
                    <span className="break-words">{company.tradingName}</span>
                  </Row>
                )}
                <Row label="Type" inline>
                  {company.companyTypeDisplay}
                </Row>
                <Row label="ACN" inline>
                  {company.acn}
                </Row>
                <Row label="Ownership overview" inline>
                  {company.shareOwnershipWithMembers ? 'Shared with members' : 'Not shared'}
                </Row>
                {company.abn && (
                  <Row label="ABN" inline>
                    {company.abn}
                  </Row>
                )}
                {data.canAdmin && company.email && (
                  <Row label="Email" inline>
                    <span className="break-all">{company.email}</span>
                  </Row>
                )}
                {company.phone && (
                  <Row label="Phone" inline>
                    {company.phone}
                  </Row>
                )}
                {address && (
                  <Row label="Address" inline>
                    <span className="break-words">{address}</span>
                  </Row>
                )}
              </Rows>
              <p className="text-sm text-text-muted">Company information is provided by the company.</p>
              {data.canAdmin && (
                <Actions>
                  <PageAction
                    ref={editAction}
                    compact
                    label="Edit"
                    context="company"
                    onClick={() => setEditing(company)}
                    disabled={data.isRefreshing}
                  />
                  <PageAction
                    compact
                    destructive
                    label="Delete"
                    context="company"
                    disabled={data.isRefreshing}
                    onClick={() => setDeleting(true)}
                  />
                </Actions>
              )}
              {deleting && <DeleteCompany company={company} data={data} onClose={() => setDeleting(false)} />}
            </>
          )}
        </>
      )}
    </Section>
  );
}

function DeleteCompany({
  company,
  data,
  onClose,
}: {
  company: Company;
  data: ReturnType<typeof useCompanySelection>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const removal = useCompanyDeletion({
    company,
    read: data,
    onDeleted: () => void navigate(DESTINATIONS.home.path, { replace: true }),
  });
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Delete ${company.name}?`}
      showFooter
      confirmLabel="Delete"
      destructive
      onConfirm={() => removal.mutate()}
      busy={removal.isPending}
      busyLabel="Deleting…"
    >
      <p className="text-sm text-text-primary">
        This deletes the company and all its records for everyone. This can’t be undone.
      </p>
      {removal.isError && (
        <p role="alert" className="mt-3 text-sm text-error-light">
          {failureSentence(removal.error, 'The company was not deleted. Try again.')}
        </p>
      )}
    </Modal>
  );
}
