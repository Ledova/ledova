import { useCallback, useState } from 'react';
import {
  MEMBER_CERTIFICATE_STATUS_LABELS,
  REGISTER_CORRECTION_COPY,
  formatDate,
  formatDateTime,
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
import { Disclosure, Row, Rows, Section } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { ClassCertificate } from './ClassCertificate';
import { useMemberCertificateDownload } from './useMemberCertificateDownload';

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
}) {
  const [editing, setEditing] = useState<string | null>(null);
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
  const records = new Map<string, CertificateRecord>();
  for (const entry of company?.entries ?? []) {
    if (['issue', 'transfer'].includes(entry.kind) && Number.isSafeInteger(entry.sequence) && entry.sequence > 0)
      records.set(entry.uuid, { uuid: entry.uuid, company: entry, own: ownById.get(entry.uuid) });
  }
  for (const entry of ownEntries)
    if (!records.has(entry.uuid)) records.set(entry.uuid, { uuid: entry.uuid, own: entry });
  const ordered = [...records.values()].sort((a, b) =>
    (b.company?.recordedAt ?? b.own?.createdAt ?? '').localeCompare(a.company?.recordedAt ?? a.own?.createdAt ?? ''),
  );
  const requests = [...(record ? (read.requests?.certificates ?? []) : [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const otherRequests = requests.filter(
    (request) => request.token !== selectedClass?.uuid || !records.has(request.entry),
  );
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
    <Section title="Certificate records">
      {ordered.length === 0 && (
        <p className="text-sm text-text-muted">No eligible certificate records in the loaded entries.</p>
      )}
      {ordered.length > 0 && !editing && (
        <div
          hidden={!!editing}
          className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 text-xs font-medium text-text-muted md:grid"
          aria-hidden="true"
        >
          <span>Shareholder</span>
          <span>Shares</span>
          <span>Date</span>
          <span>Certificate</span>
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
          const eligible = !!row.company && !row.company.correctedBy;
          const changes = row.company?.changes ?? [
            { member: record!.member, name: record!.name, shares: row.own!.delta },
          ];
          const focused = editing === row.uuid;
          return (
            <li
              key={`${selectedClass?.uuid}/${row.uuid}`}
              hidden={!!editing && !focused}
              className="space-y-3 py-4 text-sm"
            >
              <div hidden={focused}>
                <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-1 md:col-span-2">
                    {changes.map((change) => (
                      <div key={change.member} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
                        <p className="break-words font-medium">
                          {change.name ?? 'Shareholder'}
                          {change.member === record?.member && (
                            <span className="ml-2 text-xs text-brand-light">You</span>
                          )}
                        </p>
                        <p className="break-words">
                          {shareChange(change.shares)} {selectedClass?.symbol} shares
                        </p>
                      </div>
                    ))}
                    <p className="text-text-muted">
                      {kind} · {selectedClass?.symbol}
                    </p>
                  </div>
                  <p>
                    {['issue', 'transfer'].includes(entry.kind.toLowerCase())
                      ? formatDate(entry.companyEventOn, 'Not recorded')
                      : formatDate(entry.effectiveOn)}
                  </p>
                  <p className="font-medium">
                    {latest
                      ? MEMBER_CERTIFICATE_STATUS_LABELS[latest.status]
                      : entry.correctedBy
                        ? 'Reversed'
                        : receiving
                          ? 'Not requested'
                          : eligible
                            ? 'Available'
                            : 'Not applicable'}
                  </p>
                </div>
                <Disclosure summary="Record details">
                  <Rows>
                    <Row label="Entry">{entry.sequence}</Row>
                    <Row label="Ledger date">{formatDate(entry.effectiveOn)}</Row>
                    <Row label="Recorded">{formatDateTime(row.company?.recordedAt ?? row.own!.createdAt)}</Row>
                    {latest && <Row label="Requested">{formatDateTime(latest.createdAt)}</Row>}
                  </Rows>
                  {related.length > 1 && (
                    <div className="divide-y divide-border-subtle">
                      <h4 className="pt-3 text-sm font-medium">Previous requests</h4>
                      {related.slice(1).map(requestRecord)}
                    </div>
                  )}
                </Disclosure>
              </div>
              <div className={focused ? 'w-full' : 'flex flex-wrap justify-end gap-2'}>
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
            </li>
          );
        })}
      </ul>
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
        <div hidden={!!editing}>
          <Disclosure summary="Other certificate requests">
            <div className="divide-y divide-border-subtle">{otherRequests.map(requestRecord)}</div>
          </Disclosure>
        </div>
      )}
    </Section>
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
        label="Withdraw certificate request"
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
        label="Download unsigned certificate"
        context={`requested ${formatDateTime(request.createdAt)}`}
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
