import { useCallback, useState } from 'react';
import {
  CERTIFICATE_NONE_DUE,
  certificateFacts,
  certificateStatus,
  isCertificateEntry,
  shareChange,
  type CertificateFilterValues,
  type OrderSubmissionOwner,
  type OwnMemberEntry,
  type OwnMemberRecord,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LoadMore, TABLE_SCROLL_CLASS, TABLE_HEADER_CLASS } from '@components/List';
import { ClassCertificate } from './ClassCertificate';

export type CertificateClass = Pick<OwnMemberRecord['classes'][number], 'uuid' | 'name' | 'symbol'>;
export type CompanyCertificateSource = {
  owner: OrderSubmissionOwner;
  register: TokenHoldersResponse;
  entries: RegisterEntry[];
  guard: () => void;
  sourceReady: boolean;
  readReady: boolean;
  more: { hasMore: boolean; failed: boolean; loading: boolean; onLoad: () => unknown };
};
export type OwnCertificateSource = Pick<OwnMemberRecord, 'member' | 'name'> & { entries: OwnMemberEntry[] };
type CertificateRecord = { uuid: string; company?: RegisterEntry; own?: OwnMemberEntry };

const COMPANY_COLUMNS =
  'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_10rem]';
const OWN_COLUMNS = 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]';

export function CertificateRecords({
  selectedClass,
  onEditingChange,
  company,
  own,
  filters,
}: {
  selectedClass?: CertificateClass;
  onEditingChange?: (open: boolean) => void;
  company?: CompanyCertificateSource;
  own?: OwnCertificateSource;
  filters?: CertificateFilterValues;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const editingChange = useCallback(
    (uuid: string, open: boolean) => {
      setEditing((current) => (open ? uuid : current === uuid ? null : current));
      onEditingChange?.(open);
    },
    [onEditingChange],
  );
  const records: CertificateRecord[] = company
    ? company.entries.filter(isCertificateEntry).map((entry) => ({ uuid: entry.uuid, company: entry }))
    : (own?.entries ?? []).map((entry) => ({ uuid: entry.uuid, own: entry }));
  const ordered = records.sort((a, b) =>
    (b.company?.recordedAt ?? b.own?.createdAt ?? '').localeCompare(a.company?.recordedAt ?? a.own?.createdAt ?? ''),
  );
  const filtered = !!filters && (!!filters.search || filters.status !== 'all');
  const columns = company ? COMPANY_COLUMNS : OWN_COLUMNS;
  return (
    <>
      {filtered && ordered.length === 0 && (
        <p role="status" className="text-sm text-text-muted">
          No certificate records match these filters.
        </p>
      )}
      {ordered.length === 0 && !filtered && (
        <p className="text-sm text-text-muted">
          {company
            ? 'No eligible certificate records in the loaded entries.'
            : selectedClass
              ? 'No register entries for this class yet.'
              : 'No register entries yet.'}
        </p>
      )}
      <div className={ordered.length > 0 && !editing ? TABLE_SCROLL_CLASS : undefined}>
        {ordered.length > 0 && !editing && (
          <div className={`${TABLE_HEADER_CLASS} hidden py-3 font-medium md:block`} aria-hidden="true">
            <div className={`grid gap-4 ${columns}`}>
              <span>{company ? 'Shareholder' : 'Change'}</span>
              <span className="text-right">Shares</span>
              <span>Date</span>
              {company && <span className="hidden text-right xl:block">Certificate</span>}
            </div>
          </div>
        )}
        <ul aria-label="Certificate records" className="divide-y divide-border-subtle">
          {ordered.map((row) => {
            const entry = row.company ?? row.own!;
            const facts = certificateFacts(entry, selectedClass?.symbol);
            const changes = row.company?.changes ?? [
              { member: own!.member, name: facts.entry, shares: row.own!.delta },
            ];
            const focused = editing === row.uuid;
            return (
              <li
                key={`${selectedClass?.uuid}/${row.uuid}`}
                hidden={!!editing && !focused}
                className={`grid gap-1 py-3 text-sm md:gap-4 md:py-4 ${columns}`}
              >
                <span className="min-w-0 space-y-1 md:col-span-2">
                  {changes.map((change) => (
                    <span key={change.member} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                      <span className="break-words font-medium">{change.name ?? 'Shareholder'}</span>
                      <span className="whitespace-nowrap text-right tabular-nums">
                        {shareChange(change.shares)} {selectedClass?.symbol} shares
                      </span>
                    </span>
                  ))}
                  <span className={`block text-xs text-text-muted md:text-sm ${row.company ? '' : 'md:hidden'}`}>
                    {row.company && facts.entry}
                    <span className="md:hidden">
                      {row.company && ' · '}
                      {facts.dates}
                    </span>
                  </span>
                </span>
                <span className="hidden text-text-muted md:block">
                  {facts.date}
                  {facts.ledgerDate && (
                    <span className="block">
                      Ledger date <span className="whitespace-nowrap">{facts.ledgerDate}</span>
                    </span>
                  )}
                </span>
                {company && row.company && (
                  <div
                    className={
                      focused
                        ? 'md:col-span-3 xl:col-span-4'
                        : 'flex flex-wrap items-start justify-end gap-2 empty:hidden md:col-span-3 xl:col-span-1'
                    }
                  >
                    {certificateStatus(row.company) === 'reversed' && (
                      <span className="mr-auto text-xs text-text-muted md:text-sm xl:mr-0 xl:text-right">
                        <span className="md:sr-only">Certificate: </span>
                        {CERTIFICATE_NONE_DUE}
                      </span>
                    )}
                    <ClassCertificate
                      sourceKey={`${company.owner.userUuid}/${company.owner.ownerAccountUuid}`}
                      register={company.register}
                      entry={row.company}
                      guard={company.guard}
                      sourceReady={company.sourceReady}
                      onEditingChange={editingChange}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {company && (
        <div hidden={!!editing}>
          <LoadMore noun={['register entry', 'register entries']} {...company.more} disabled={!company.readReady} />
        </div>
      )}
    </>
  );
}
