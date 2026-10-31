import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CERTIFICATE_STATUSES,
  formatDate,
  useSubmissionOwner,
  type CertificateStatus,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { LoadError, Loading, Section, Failure } from '@components/Ledger';
import { Confirmation } from '@components/Modal';
import { Page, PageAction, PageActions } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useRunningAction } from '@hooks/useRunningAction';
import { CertificateRecords, type CertificateClass, type CompanyCertificateSource } from './CertificateRecords';
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
  const waitingForMember =
    !!context?.company?.memberUuids.length &&
    (read.record?.company.uuid !== context.company.uuid || read.selectedUuid !== read.record.uuid || !read.requests);
  return (
    <PageTitle.Provider value="Certificates">
      <Page>
        {read.readFailed ? (
          <LoadError retry={read.refresh} busy={read.busy || read.refreshing}>
            Your member records could not be loaded.
          </LoadError>
        ) : context?.directory.hasError ? (
          <LoadError retry={context.directory.retry} busy={context.directory.isRefreshing}>
            Your company access could not be confirmed.
          </LoadError>
        ) : !owner ||
          context?.directory.isLoading ||
          context?.directory.isRefreshing ||
          read.loading ||
          waitingForMember ? (
          <Loading>Loading certificate records…</Loading>
        ) : !context?.company ? (
          <CompanyContextNotice />
        ) : context.company.canReadRegister ? (
          <CompanyCertificates
            key={`${owner.userUuid}/${owner.ownerAccountUuid}/${context.company.uuid}`}
            owner={owner}
            currentOwner={boundary.get}
            company={context.company.uuid}
            filters={filters}
          />
        ) : context.company.memberUuids.length ? (
          <PersonalCertificates
            key={`${owner.userUuid}/${owner.ownerAccountUuid}/${context.company.uuid}`}
            company={context.company.uuid}
            filters={filters}
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
  const workspace = useMemberWorkspace();
  const requested = new URLSearchParams(location.search).get('class');
  const association =
    workspace.read.record?.company.uuid === company && workspace.read.selectedUuid === workspace.read.record.uuid
      ? workspace.read.record.uuid
      : undefined;
  const source = useCompanyCertificates(
    owner,
    currentOwner,
    company,
    requested,
    workspace.token,
    filters,
    association,
    workspace.read.requests?.certificates,
  );
  const selected = source.options.find((item) => item.uuid === source.token);
  return (
    <CertificateWorkspace
      classes={source.options}
      selected={selected}
      disabled={editing}
      filters={filters}
      companyReader
      ownRecord={!!association}
    >
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
        <Records
          key={JSON.stringify([company, selected?.uuid, workspace.read.selectedUuid, filters])}
          companyUuid={company}
          onEditingChange={setEditing}
          selected={selected}
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

function PersonalCertificates({ company, filters }: { company: string; filters: CertificateFilterValues }) {
  const { read, token } = useMemberWorkspace();
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get('class');
  const record = read.record?.company.uuid === company && read.selectedUuid === read.record.uuid ? read.record : null;
  const classes = record?.classes ?? [];
  const selected = classes.find((item) => item.uuid === (requested ?? token));
  if (!record || !read.requests || (!requested && classes.length > 0 && !selected))
    return <Loading>Loading your certificate records…</Loading>;
  return (
    <CertificateWorkspace classes={classes} selected={selected} filters={filters} companyReader={false} ownRecord>
      {requested && !selected ? (
        <p className="text-sm text-text-muted">Your account has no member record for this share class.</p>
      ) : selected && !read.entriesReady ? (
        <Loading>Loading your certificate records…</Loading>
      ) : (
        <Records
          key={JSON.stringify([company, selected?.uuid, read.selectedUuid, filters])}
          companyUuid={company}
          selected={selected}
          filters={filters}
        />
      )}
    </CertificateWorkspace>
  );
}

function CertificateWorkspace({
  classes,
  selected,
  children,
  disabled = false,
  filters,
  companyReader,
  ownRecord,
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  children: ReactNode;
  disabled?: boolean;
  filters: CertificateFilterValues;
  companyReader: boolean;
  ownRecord: boolean;
}) {
  const { read, held } = useMemberWorkspace();
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
        <CertificateFilters
          classes={classes}
          selected={selected}
          applied={filters}
          disabled={disabled || held}
          companyReader={companyReader}
          ownRecord={ownRecord}
        />
      </PageActions>
      <Failure>{read.error}</Failure>
      {read.retry && (
        <div className="flex justify-end">
          <PageAction
            label="Retry original member action"
            disabled={read.busy || read.refreshing || read.readFailed || !read.owner}
            onClick={() => void read.recover()}
          />
        </div>
      )}
      {CERTIFICATE_STATUSES.some(([value]) => value === filters.status) ? (
        children
      ) : (
        <Failure>This certificate status is unavailable. Choose a status or Clear in Filters.</Failure>
      )}
    </Section>
  );
}

function Records({
  selected,
  company,
  companyUuid,
  onEditingChange,
  filters,
}: {
  selected?: CertificateClass;
  company?: CompanyCertificateSource;
  companyUuid: string;
  onEditingChange?: (open: boolean) => void;
  filters: CertificateFilterValues;
}) {
  const { read, held, token } = useMemberWorkspace();
  const [withdrawing, setWithdrawing] = useState<{ uuid: string; createdAt: string } | null>(null);
  const { running, track } = useRunningAction();
  const record =
    read.record?.company.uuid === companyUuid && read.selectedUuid === read.record.uuid ? read.record : null;
  const ownClass = !!selected && record?.classes.some((item) => item.uuid === selected.uuid);
  if (ownClass && (!read.requests || token !== selected.uuid || !read.entriesReady))
    return <Loading>Loading your certificate records…</Loading>;
  return (
    <>
      <CertificateRecords
        companyUuid={companyUuid}
        onEditingChange={onEditingChange}
        read={read}
        selectedClass={selected}
        company={company}
        held={held}
        running={running}
        filters={filters}
        onRequest={(uuid) => track(`certificate:${uuid}`, read.requestCertificate(uuid))}
        onWithdraw={(request) => setWithdrawing({ uuid: request.uuid, createdAt: request.createdAt })}
      />
      {withdrawing && (
        <Confirmation
          isOpen
          title="Withdraw this certificate request?"
          confirmLabel="Withdraw certificate request"
          confirmDisabled={held}
          busy={read.busy}
          busyLabel="Withdrawing…"
          onClose={() => setWithdrawing(null)}
          onConfirm={() => void read.withdraw(withdrawing.uuid).finally(() => setWithdrawing(null))}
        >
          The company won&apos;t fulfil your request of {formatDate(withdrawing.createdAt)}. You can request a
          certificate for the same entry again.
        </Confirmation>
      )}
    </>
  );
}
