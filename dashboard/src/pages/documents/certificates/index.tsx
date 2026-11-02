import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CERTIFICATE_STATUSES,
  useSubmissionOwner,
  type CertificateStatus,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { LoadError, Loading, Section, Failure } from '@components/Ledger';
import { Page, PageActions } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { CertificateRecords, type CertificateClass } from './CertificateRecords';
import { CertificateFilters } from './CertificateFilters';
import { useCompanyCertificates, type CertificateFilterValues } from './useCompanyCertificates';

export default function CertificatesPage() {
  const context = useCompanyContext();
  const { read } = useMemberWorkspace();
  const { owner, boundary } = useSubmissionOwner();
  const query = new URLSearchParams(useLocation().search);
  const filters: CertificateFilterValues = {
    search: (query.get('q') ?? '').slice(0, 100),
    status: (query.get('certificate_status') ?? 'all') as CertificateStatus,
  };
  const company = context?.company;
  const personal = !!company && !company.canReadRegister && company.memberUuids.length > 0;
  const waitingForMember =
    personal && (read.record?.company.uuid !== company?.uuid || read.selectedUuid !== read.record.uuid);
  return (
    <PageTitle.Provider value="Certificates">
      <Page>
        {personal && read.readFailed ? (
          <LoadError retry={read.refresh} busy={read.refreshing}>
            Your member records could not be loaded.
          </LoadError>
        ) : context?.directory.hasError ? (
          <LoadError retry={context.directory.retry} busy={context.directory.isRefreshing}>
            Your company access could not be confirmed.
          </LoadError>
        ) : !owner ||
          context?.directory.isLoading ||
          context?.directory.isRefreshing ||
          (personal && read.loading) ||
          waitingForMember ? (
          <Loading>Loading certificate records…</Loading>
        ) : !company ? (
          <CompanyContextNotice />
        ) : company.canReadRegister ? (
          <CompanyCertificates
            key={`${owner.userUuid}/${owner.ownerAccountUuid}/${company.uuid}`}
            owner={owner}
            currentOwner={boundary.get}
            company={company.uuid}
            filters={filters}
          />
        ) : personal ? (
          <PersonalCertificates
            key={`${owner.userUuid}/${owner.ownerAccountUuid}/${company.uuid}`}
            company={company.uuid}
          />
        ) : (
          <p className="text-sm text-text-muted">Your account has no certificate access for this company.</p>
        )}
      </Page>
    </PageTitle.Provider>
  );
}

function CompanyCertificates({
  owner,
  currentOwner,
  company,
  filters,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  filters: CertificateFilterValues;
}) {
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const requested = new URLSearchParams(location.search).get('class');
  const source = useCompanyCertificates(owner, currentOwner, company, requested, filters);
  const selected = source.options.find((item) => item.uuid === source.token);
  return (
    <CertificateWorkspace classes={source.options} selected={selected} disabled={editing} filters={filters}>
      {source.hasError ? (
        <LoadError retry={source.retry} busy={source.isRefreshing}>
          Certificate records could not be loaded.
        </LoadError>
      ) : !source.sourceReady ? (
        <Loading>Loading certificate records…</Loading>
      ) : requested && !selected ? (
        <p className="text-sm text-text-muted">This share class is unavailable for the selected company.</p>
      ) : selected && !source.ready ? (
        <Loading>Loading certificate records…</Loading>
      ) : (
        <CertificateRecords
          key={JSON.stringify([company, selected?.uuid, filters])}
          onEditingChange={setEditing}
          selectedClass={selected}
          filters={filters}
          company={
            source.register && selected
              ? {
                  owner,
                  register: source.register,
                  entries: source.entries,
                  guard: source.guard,
                  sourceReady: source.ready && !source.more.failed && !source.more.loading,
                  readReady: source.ready,
                  more: source.more,
                }
              : undefined
          }
        />
      )}
    </CertificateWorkspace>
  );
}

function PersonalCertificates({ company }: { company: string }) {
  const { read, held, token } = useMemberWorkspace();
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get('class');
  const record = read.record?.company.uuid === company && read.selectedUuid === read.record.uuid ? read.record : null;
  const classes = record?.classes ?? [];
  const selected = classes.find((item) => item.uuid === (requested ?? token));
  if (!record || (!requested && classes.length > 0 && !selected))
    return <Loading>Loading your certificate records…</Loading>;
  return (
    <CertificateWorkspace classes={classes} selected={selected} disabled={held} failure={read.error}>
      {requested && !selected ? (
        <p className="text-sm text-text-muted">Your account has no member record for this share class.</p>
      ) : selected && (token !== selected.uuid || !read.entriesReady) ? (
        <Loading>Loading your certificate records…</Loading>
      ) : (
        <CertificateRecords
          key={JSON.stringify([company, selected?.uuid, read.selectedUuid])}
          selectedClass={selected}
          own={{
            member: record.member,
            name: record.name,
            entries: selected && read.selectedToken === selected.uuid ? read.entries : [],
          }}
        />
      )}
    </CertificateWorkspace>
  );
}

function CertificateWorkspace({
  classes,
  selected,
  children,
  disabled,
  filters,
  failure,
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  children: ReactNode;
  disabled: boolean;
  filters?: CertificateFilterValues;
  failure?: string | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('class');
  useEffect(() => {
    if (requested || !selected) return;
    const query = new URLSearchParams(location.search);
    query.set('class', selected.uuid);
    navigate({ search: query.toString(), hash: location.hash }, { replace: true, state: location.state });
  }, [requested, selected, location, navigate]);
  return (
    <Section title="Certificate records">
      <PageActions>
        <CertificateFilters classes={classes} selected={selected} applied={filters} disabled={disabled} />
      </PageActions>
      <Failure>{failure}</Failure>
      {!filters || CERTIFICATE_STATUSES.some(([value]) => value === filters.status) ? (
        children
      ) : (
        <Failure>This certificate status is unavailable. Choose a status or Clear in Filters.</Failure>
      )}
    </Section>
  );
}
