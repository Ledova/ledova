import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CERTIFICATE_STATUSES,
  useCompanyCertificates,
  useSubmissionOwner,
  useAuth,
  useUserPreferences,
  type CertificateFilterValues,
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

export default function CertificatesPage() {
  const context = useCompanyContext();
  const { read } = useMemberWorkspace();
  const { owner, boundary } = useSubmissionOwner();
  const authentication = useAuth();
  const preferences = useUserPreferences();
  const query = new URLSearchParams(useLocation().search);
  const filters: CertificateFilterValues = {
    search: (query.get('q') ?? '').slice(0, 100),
    status: (query.get('certificate_status') ?? 'all') as CertificateStatus,
  };
  const company = context?.company;
  const personal = !!company && !company.canReadRegister && company.memberUuids.length > 0;
  const companyUuid = context?.companyUuid ?? company?.uuid ?? '';
  const scope = owner && companyUuid ? `${owner.userUuid}/${owner.ownerAccountUuid}/${companyUuid}` : '';
  const confirmed =
    !!owner &&
    !authentication.isFetching &&
    !preferences.isError &&
    preferences.fetchStatus === 'idle' &&
    !!context &&
    context.directory.owner?.userUuid === owner.userUuid &&
    context.directory.owner.ownerAccountUuid === owner.ownerAccountUuid &&
    !context.directory.hasError &&
    !context.directory.isLoading &&
    !context.directory.isRefreshing;
  const access = company?.canReadRegister ? 'company' : personal ? 'personal' : null;
  const [retained, setRetained] = useState({ scope, access });
  if (retained.scope !== scope || (confirmed && retained.access !== access))
    setRetained({ scope, access: confirmed ? access : null });
  const currentAccess = confirmed ? access : retained.scope === scope ? retained.access : null;
  const waitingForMember =
    currentAccess === 'personal' &&
    (read.record?.company.uuid !== companyUuid || read.selectedUuid !== read.record.uuid);
  const available =
    confirmed && (currentAccess !== 'personal' || (!read.readFailed && !read.loading && !waitingForMember));
  return (
    <PageTitle.Provider value="Certificates">
      <Page>
        {currentAccess === 'personal' && read.readFailed ? (
          <LoadError retry={read.refresh} busy={read.refreshing}>
            Your member records could not be loaded.
          </LoadError>
        ) : context?.directory.hasError ? (
          <LoadError retry={context.directory.retry} busy={context.directory.isRefreshing}>
            Your company access could not be confirmed.
          </LoadError>
        ) : !available ? (
          <Loading>Loading certificate records…</Loading>
        ) : !company ? (
          <CompanyContextNotice />
        ) : !access ? (
          <p className="text-sm text-text-muted">Your account has no certificate access for this company.</p>
        ) : null}
        {owner && companyUuid && currentAccess === 'company' ? (
          <CompanyCertificates
            key={scope}
            owner={owner}
            currentOwner={boundary.get}
            company={companyUuid}
            filters={filters}
            available={available}
          />
        ) : owner && companyUuid && currentAccess === 'personal' ? (
          <PersonalCertificates key={scope} company={companyUuid} available={available} />
        ) : null}
      </Page>
    </PageTitle.Provider>
  );
}

function CompanyCertificates({
  owner,
  currentOwner,
  company,
  filters,
  available,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  filters: CertificateFilterValues;
  available: boolean;
}) {
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const requested = new URLSearchParams(location.search).get('class');
  const source = useCompanyCertificates(owner, currentOwner, company, requested, filters, undefined, available);
  const selected = source.options.find((item) => item.uuid === source.token);
  const readable = available && source.sourceReady && !source.sourcePaused;
  const notice = source.hasError ? (
    <LoadError retry={source.retry} busy={source.isRefreshing}>
      Certificate records could not be loaded.
    </LoadError>
  ) : (
    <Loading>Loading certificate records…</Loading>
  );
  return (
    <>
      {available && !readable && notice}
      <CertificateWorkspace
        classes={source.options}
        selected={selected}
        disabled={editing || !available}
        filters={filters}
        available={readable}
      >
        {!readable ? null : source.hasError ? (
          notice
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
    </>
  );
}

function PersonalCertificates({ company, available }: { company: string; available: boolean }) {
  const { read, held, token } = useMemberWorkspace();
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get('class');
  const record = read.record?.company.uuid === company && read.selectedUuid === read.record.uuid ? read.record : null;
  const classes = record?.classes ?? [];
  const selected = classes.find((item) => item.uuid === (requested ?? token));
  return (
    <CertificateWorkspace
      classes={classes}
      selected={selected}
      disabled={held || !available}
      failure={read.error}
      available={available}
    >
      {!available ? null : !record || (!requested && classes.length > 0 && !selected) ? (
        <Loading>Loading your certificate records…</Loading>
      ) : requested && !selected ? (
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
  available,
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  children: ReactNode;
  disabled: boolean;
  filters?: CertificateFilterValues;
  failure?: string | null;
  available: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('class');
  useEffect(() => {
    if (!available || requested || !selected) return;
    const query = new URLSearchParams(location.search);
    query.set('class', selected.uuid);
    navigate({ search: query.toString(), hash: location.hash }, { replace: true, state: location.state });
  }, [available, requested, selected, location, navigate]);
  return (
    <div hidden={!available}>
      <Section title="Certificate records">
        <PageActions>
          <div hidden={!available}>
            <CertificateFilters
              classes={classes}
              selected={selected}
              applied={filters}
              disabled={disabled}
              available={available}
            />
          </div>
        </PageActions>
        <Failure>{failure}</Failure>
        {!filters || CERTIFICATE_STATUSES.some(([value]) => value === filters.status) ? (
          children
        ) : (
          <Failure>This certificate status is unavailable. Choose a status or Clear in Filters.</Failure>
        )}
      </Section>
    </div>
  );
}
