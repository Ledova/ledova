import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatDate, useSubmissionOwner, type OrderSubmissionOwner } from '@ledova/shared';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { LoadError, Loading } from '@components/Ledger';
import { Confirmation } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { SelectField } from '@components/SelectField';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useRunningAction } from '@hooks/useRunningAction';
import { CertificateRecords, type CertificateClass, type CompanyCertificateSource } from './CertificateRecords';
import { useCompanyCertificates } from './useCompanyCertificates';

export default function CertificatesPage() {
  const context = useCompanyContext();
  const { read } = useMemberWorkspace();
  const { owner, boundary } = useSubmissionOwner();
  return (
    <PageTitle.Provider value="Certificates">
      <Page lede="Prepare, request and download share certificates.">
        {read.readFailed ? (
          <LoadError retry={read.refresh} busy={read.busy || read.refreshing}>
            Your member records could not be loaded.
          </LoadError>
        ) : context?.directory.hasError ? (
          <LoadError retry={context.directory.retry} busy={context.directory.isRefreshing}>
            Your company access could not be confirmed.
          </LoadError>
        ) : !owner || context?.directory.isLoading || context?.directory.isRefreshing || read.loading ? (
          <Loading>Loading certificate records…</Loading>
        ) : !context?.company ? (
          <CompanyContextNotice />
        ) : context.company.canReadRegister ? (
          <CompanyCertificates
            key={`${owner.userUuid}/${owner.ownerAccountUuid}/${context.company.uuid}`}
            owner={owner}
            currentOwner={boundary.get}
            company={context.company.uuid}
          />
        ) : context.company.memberUuids.length ? (
          <PersonalCertificates
            key={`${owner.userUuid}/${owner.ownerAccountUuid}/${context.company.uuid}`}
            company={context.company.uuid}
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
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
}) {
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const workspace = useMemberWorkspace();
  const requested = new URLSearchParams(location.search).get('class');
  const source = useCompanyCertificates(owner, currentOwner, company, requested, workspace.token);
  const selected = source.options.find((item) => item.uuid === source.token);
  return (
    <CertificateWorkspace classes={source.options} selected={selected} disabled={editing}>
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
          key={`${company}/${selected?.uuid ?? ''}/${workspace.read.selectedUuid}`}
          companyUuid={company}
          onEditingChange={setEditing}
          selected={selected}
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
  const { read, token } = useMemberWorkspace();
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get('class');
  const record = read.record?.company.uuid === company && read.selectedUuid === read.record.uuid ? read.record : null;
  const classes = record?.classes ?? [];
  const selected = classes.find((item) => item.uuid === (requested ?? token));
  if (!record || !read.requests || (!requested && classes.length > 0 && !selected))
    return <Loading>Loading your certificate records…</Loading>;
  return (
    <CertificateWorkspace classes={classes} selected={selected}>
      {requested && !selected ? (
        <p className="text-sm text-text-muted">Your account has no member record for this share class.</p>
      ) : selected && !read.entriesReady ? (
        <Loading>Loading your certificate records…</Loading>
      ) : (
        <Records
          key={`${company}/${selected?.uuid ?? ''}/${read.selectedUuid}`}
          companyUuid={company}
          selected={selected}
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
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  children: ReactNode;
  disabled?: boolean;
}) {
  const { read } = useMemberWorkspace();
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
    <>
      {read.error && (
        <p role="alert" className="text-sm text-error-light">
          {read.error}
        </p>
      )}
      {read.retry && (
        <PageAction
          label="Retry original member action"
          disabled={read.busy || read.refreshing || read.readFailed || !read.owner}
          onClick={() => void read.recover()}
        />
      )}
      {classes.length > 1 ? (
        <div className="max-w-sm">
          <SelectField
            label="Share class"
            value={selected?.uuid ?? ''}
            options={classes.map((item) => ({ value: item.uuid, label: `${item.name} · ${item.symbol}` }))}
            disabled={disabled || read.busy || !!read.retry}
            onChange={(uuid) => {
              const query = new URLSearchParams(location.search);
              query.set('class', uuid);
              navigate({ search: query.toString(), hash: location.hash }, { state: location.state });
            }}
          />
        </div>
      ) : selected ? (
        <p className="text-sm text-text-muted">
          {selected.name} · {selected.symbol}
        </p>
      ) : null}
      {children}
    </>
  );
}

function Records({
  selected,
  company,
  companyUuid,
  onEditingChange,
}: {
  selected?: CertificateClass;
  company?: CompanyCertificateSource;
  companyUuid: string;
  onEditingChange?: (open: boolean) => void;
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
