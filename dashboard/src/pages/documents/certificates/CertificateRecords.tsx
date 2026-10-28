import { useCallback, useId, useState } from 'react';
import {
  MEMBER_CERTIFICATE_STATUS_LABELS,
  REGISTER_CORRECTION_COPY,
  formatDate,
  formatDateTime,
  searchRows,
  shareChange,
  type MemberCertificateRequest,
  type OrderSubmissionOwner,
  type OwnMemberEntry,
  type OwnMemberRecord,
  type RegisterEntry,
  type RegisterEntryKind,
  type TokenHoldersResponse,
  type useMemberRecords,
} from '@ledova/shared';
import { MoreToggle } from '@components/Ledger';
import { LoadMore, TABLE_SCROLL_CLASS, TABLE_HEADER_CLASS } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { ClassCertificate } from './ClassCertificate';
import { useMemberCertificateDownload } from './useMemberCertificateDownload';
import { CERTIFICATE_STATUSES, type CertificateFilterValues, type CertificateStatus } from './useCompanyCertificates';

export type CertificateClass = Pick<OwnMemberRecord['classes'][number], 'uuid' | 'name' | 'symbol'>;
type Read = ReturnType<typeof useMemberRecords>;
export type CompanyCertificateSource = {
  owner: OrderSubmissionOwner;
  register: TokenHoldersResponse;
  entries: RegisterEntry[];
  guard: () => void;
  sourceReady: boolean;
  readReady: boolean;
  more: { hasMore: boolean; failed: boolean; loading: boolean; onLoad: () => unknown };
};
type CertificateRecord = { uuid: string; company?: RegisterEntry; own?: OwnMemberEntry };

const ROW_COLUMNS =
  'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_10rem]';

export function CertificateRecords({
  read,
  selectedClass,
  companyUuid,
  onEditingChange,
  company,
  held,
  running,
  onRequest,
  onWithdraw,
  filters,
}: {
  read: Read;
  selectedClass?: CertificateClass;
  companyUuid: string;
  onEditingChange?: (open: boolean) => void;
  company?: CompanyCertificateSource;
  held: boolean;
  running: string | null;
  onRequest: (uuid: string) => void;
  onWithdraw: (request: MemberCertificateRequest) => void;
  filters: CertificateFilterValues;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const otherId = useId();
  const retry = read.retry;
  const record =
    read.record?.company.uuid === companyUuid && read.selectedUuid === read.record.uuid ? read.record : null;
  const editingChange = useCallback(
    (uuid: string, open: boolean) => {
      setEditing((current) => (open ? uuid : current === uuid ? null : current));
      onEditingChange?.(open);
    },
    [onEditingChange],
  );
  const own =
    record?.classes.some((item) => item.uuid === selectedClass?.uuid) && read.selectedToken === selectedClass?.uuid;
  const ownEntries = own ? read.entries : [];
  const ownById = new Map(ownEntries.map((entry) => [entry.uuid, entry]));
  const requests = [...(record ? (read.requests?.certificates ?? []) : [])].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.uuid.localeCompare(a.uuid),
  );
  const statusOf = (row: CertificateRecord): CertificateStatus => {
    const entry = row.company ?? row.own!;
    const latest = requests.find((request) => request.entry === row.uuid && request.token === selectedClass?.uuid);
    if (latest) return latest.status;
    if (entry.correctedBy) return 'reversed';
    if (row.own && ['issue', 'transfer'].includes(row.own.kind.toLowerCase()) && BigInt(row.own.delta) > 0n)
      return 'not_requested';
    return row.company ? 'can_prepare' : 'not_applicable';
  };
  const extras = searchRows(
    ownEntries.filter((entry) => !company || !['issue', 'transfer'].includes(entry.kind.toLowerCase())),
    () => record?.name ?? '',
    filters.search,
  ).filter((entry) => filters.status === 'all' || statusOf({ uuid: entry.uuid, own: entry }) === filters.status);
  const records = new Map<string, CertificateRecord>();
  for (const entry of company?.entries ?? []) {
    if (['issue', 'transfer'].includes(entry.kind) && Number.isSafeInteger(entry.sequence) && entry.sequence > 0)
      records.set(entry.uuid, { uuid: entry.uuid, company: entry, own: ownById.get(entry.uuid) });
  }
  for (const entry of extras) if (!records.has(entry.uuid)) records.set(entry.uuid, { uuid: entry.uuid, own: entry });
  const ordered = [...records.values()].sort((a, b) =>
    (b.company?.recordedAt ?? b.own?.createdAt ?? '').localeCompare(a.company?.recordedAt ?? a.own?.createdAt ?? ''),
  );
  const filtered = !!filters.search || filters.status !== 'all';
  const otherRequests = requests.filter(
    (request) => request.token !== selectedClass?.uuid || !records.has(request.entry),
  );
  const otherActive =
    (retry?.kind === 'certificate' && otherRequests.some((request) => request.entry === retry.entry)) ||
    (retry?.kind === 'withdraw' && otherRequests.some((request) => request.uuid === retry.uuid));
  const otherShown = otherExpanded || otherActive;
  const actions = (request: MemberCertificateRequest) => (
    <CertificateActions key={request.uuid} read={read} request={request} held={held} onWithdraw={onWithdraw} />
  );
  const requestRecord = (request: MemberCertificateRequest) => (
    <div key={request.uuid} className="space-y-2 py-3 text-sm">
      <p className="font-medium">
        {record?.classes.find((item) => item.uuid === request.token)?.name ?? 'Share certificate'} ·{' '}
        {MEMBER_CERTIFICATE_STATUS_LABELS[request.status]}
      </p>
      <p className="text-text-muted">Requested {formatDate(request.createdAt)}</p>
      {(request.status === 'requested' || (request.status === 'fulfilled' && request.fulfilment)) && (
        <FormActions>{actions(request)}</FormActions>
      )}
    </div>
  );
  return (
    <>
      {filtered && ordered.length === 0 && (
        <p role="status" className="text-sm text-text-muted">
          No certificate records match these filters.
        </p>
      )}
      {ordered.length === 0 && !filtered && (
        <p className="text-sm text-text-muted">No eligible certificate records in the loaded entries.</p>
      )}
      <div className={ordered.length > 0 && !editing ? TABLE_SCROLL_CLASS : undefined}>
        {ordered.length > 0 && !editing && (
          <div className={`${TABLE_HEADER_CLASS} hidden py-3 font-medium md:block`} aria-hidden="true">
            <div className={`grid gap-4 ${ROW_COLUMNS}`}>
              <span>Shareholder</span>
              <span className="text-right">Shares</span>
              <span>Date</span>
              <span>Certificate</span>
              <span className="sr-only">Action</span>
            </div>
          </div>
        )}
        <ul aria-label="Certificate records" className="divide-y divide-border-subtle">
          {ordered.map((row) => {
            const entry = row.company ?? row.own!;
            const related = requests.filter(
              (request) => request.entry === row.uuid && request.token === selectedClass?.uuid,
            );
            const latest = related[0];
            const receiving =
              !!row.own && ['issue', 'transfer'].includes(row.own.kind.toLowerCase()) && BigInt(row.own.delta) > 0n;
            const kind =
              REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind.toLowerCase() as RegisterEntryKind] ?? 'Register change';
            const changes = row.company?.changes ?? [
              { member: record!.member, name: record!.name, shares: row.own!.delta },
            ];
            const focused = editing === row.uuid;
            const companyDated = ['issue', 'transfer'].includes(entry.kind.toLowerCase());
            return (
              <li
                key={`${selectedClass?.uuid}/${row.uuid}`}
                hidden={!!editing && !focused}
                className={`grid gap-3 py-4 text-sm md:gap-4 ${ROW_COLUMNS}`}
              >
                <span className="min-w-0 space-y-1 md:col-span-2">
                  {changes.map((change) => (
                    <span key={change.member} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
                      <span className="break-words font-medium">{change.name ?? 'Shareholder'}</span>
                      <span className="break-words text-right tabular-nums">
                        {shareChange(change.shares)} {selectedClass?.symbol} shares
                      </span>
                    </span>
                  ))}
                  <span className="block text-text-muted">
                    {kind} · {selectedClass?.symbol} · entry {entry.sequence}
                  </span>
                </span>
                <span className="text-text-muted">
                  {companyDated ? formatDate(entry.companyEventOn, 'Not recorded') : formatDate(entry.effectiveOn)}
                  {companyDated && entry.effectiveOn !== entry.companyEventOn && (
                    <span className="block">
                      Ledger date <span className="whitespace-nowrap">{formatDate(entry.effectiveOn)}</span>
                    </span>
                  )}
                </span>
                <span className="text-text-muted">
                  {latest?.status === 'requested'
                    ? `Requested ${formatDate(latest.createdAt)}`
                    : CERTIFICATE_STATUSES.find(([value]) => value === statusOf(row))?.[1]}
                  {latest && latest.status !== 'requested' && (
                    <span className="block">Requested {formatDate(latest.createdAt)}</span>
                  )}
                </span>
                <div
                  className={
                    focused
                      ? 'md:col-span-4 xl:col-span-5'
                      : 'flex flex-wrap justify-end gap-2 md:col-span-4 xl:col-span-1'
                  }
                >
                  {company && row.company && (
                    <ClassCertificate
                      sourceKey={`${company.owner.userUuid}/${company.owner.ownerAccountUuid}`}
                      register={company.register}
                      entry={row.company}
                      guard={company.guard}
                      sourceReady={company.sourceReady && !held}
                      onEditingChange={editingChange}
                    />
                  )}
                  {!focused && receiving && (
                    <PageAction
                      label="Request certificate"
                      context={`${selectedClass?.name ?? 'Shares'}, entry ${entry.sequence}`}
                      busy={running === `certificate:${row.uuid}`}
                      busyLabel="Requesting…"
                      disabled={held}
                      onClick={() => onRequest(row.uuid)}
                    />
                  )}
                  {!focused && latest && actions(latest)}
                </div>
                {related.length > 1 && (
                  <div hidden={focused} className="divide-y divide-border-subtle md:col-span-4 xl:col-span-5">
                    <h4 className="text-sm font-medium">Earlier requests</h4>
                    {related.slice(1).map(requestRecord)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {company && (
        <div hidden={!!editing}>
          <LoadMore
            noun={['register entry', 'register entries']}
            {...company.more}
            disabled={held || !company.readReady}
          />
        </div>
      )}
      {otherRequests.length > 0 && (
        <div hidden={!!editing} className="space-y-2">
          <MoreToggle
            open={otherShown}
            controls={otherId}
            disabled={otherActive}
            onToggle={() => setOtherExpanded((current) => !current)}
          >
            {otherShown
              ? 'Hide other certificate requests'
              : `Show other certificate requests (${otherRequests.length})`}
          </MoreToggle>
          <div id={otherId} hidden={!otherShown} className="divide-y divide-border-subtle">
            {otherRequests.map(requestRecord)}
          </div>
        </div>
      )}
    </>
  );
}

function CertificateActions({
  read,
  request,
  held,
  onWithdraw,
}: {
  read: Read;
  request: MemberCertificateRequest;
  held: boolean;
  onWithdraw: (request: MemberCertificateRequest) => void;
}) {
  if (request.status === 'requested')
    return (
      <PageAction
        label="Withdraw request"
        context={`requested ${formatDateTime(request.createdAt)}`}
        disabled={held}
        onClick={() => onWithdraw(request)}
      />
    );
  if (request.status === 'fulfilled' && request.fulfilment)
    return <MemberCertificateDownload read={read} request={request} />;
  return null;
}

function MemberCertificateDownload({ read, request }: { read: Read; request: MemberCertificateRequest }) {
  const { busy, error, download } = useMemberCertificateDownload(read, request);
  return (
    <>
      <PageAction
        label="Download PDF"
        context={`unsigned certificate requested ${formatDateTime(request.createdAt)}`}
        busy={busy}
        busyLabel="Downloading…"
        disabled={read.busy || !!read.retry}
        onClick={() => void download()}
      />
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
    </>
  );
}
