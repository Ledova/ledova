import {
  MEMBER_CERTIFICATE_STATUS_LABELS,
  REGISTER_CORRECTION_COPY,
  formatDate,
  formatDateTime,
  shareChange,
  shortReference,
  type MemberCertificateRequest,
  type OwnMemberRecord,
  type RegisterEntryKind,
  type useMemberRecords,
} from '@ledova/shared';
import { Disclosure, Loading, Row, Rows, Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { useMemberCertificateDownload } from './useMemberCertificateDownload';

type Read = ReturnType<typeof useMemberRecords>;

export function MemberCertificates({
  read,
  selectedClass,
  held,
  running,
  onSelectClass,
  onRequest,
  onWithdraw,
}: {
  read: Read;
  selectedClass?: OwnMemberRecord['classes'][number];
  held: boolean;
  running: string | null;
  onSelectClass: (uuid: string) => void;
  onRequest: (uuid: string) => void;
  onWithdraw: (request: MemberCertificateRequest) => void;
}) {
  if (!read.record) return null;
  const requests = [...(read.requests?.certificates ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const entryIds = new Set(read.entries.map((entry) => entry.uuid));
  const otherRequests = requests.filter(
    (request) => request.token !== selectedClass?.uuid || !entryIds.has(request.entry),
  );
  const actions = (request: MemberCertificateRequest) => (
    <CertificateActions key={request.uuid} read={read} request={request} held={held} onWithdraw={onWithdraw} />
  );
  const requestRecord = (request: MemberCertificateRequest) => (
    <div key={request.uuid} className="space-y-2 py-3 text-sm">
      <p className="font-medium">
        {read.record?.classes.find((item) => item.uuid === request.token)?.name ?? 'Share certificate'} ·{' '}
        {MEMBER_CERTIFICATE_STATUS_LABELS[request.status]}
      </p>
      <p className="text-text-muted">Requested {formatDate(request.createdAt)}</p>
      <p className="break-all text-xs text-text-muted">
        Request {shortReference(request.uuid)} · Entry {shortReference(request.entry)}
      </p>
      {(request.status === 'requested' || (request.status === 'fulfilled' && request.fulfilment)) && (
        <FormActions>{actions(request)}</FormActions>
      )}
    </div>
  );
  return (
    <Section title="Certificates">
      {!read.requests ? (
        <Loading>Loading your documents and requests…</Loading>
      ) : (
        <>
          {read.record.classes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {read.record.classes.map((item) => (
                <PageAction
                  key={item.uuid}
                  label={`${item.name} · ${item.symbol}`}
                  pressed={item.uuid === selectedClass?.uuid}
                  disabled={held}
                  onClick={() => onSelectClass(item.uuid)}
                />
              ))}
            </div>
          )}
          {read.record.classes.length === 0 && requests.length === 0 && (
            <p className="text-sm text-text-muted">No share changes yet.</p>
          )}
          <div className="divide-y divide-border-subtle">
            {read.entries.map((entry) => {
              const related = requests.filter(
                (request) => request.entry === entry.uuid && request.token === selectedClass?.uuid,
              );
              const latest = related[0];
              const receiving = ['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) && BigInt(entry.delta) > 0n;
              const kind =
                REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind.toLowerCase() as RegisterEntryKind] ??
                'Register change';
              return (
                <div key={entry.uuid} className="space-y-4 py-3">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <h3 className="text-sm font-medium">
                        {shareChange(entry.delta)} {selectedClass?.symbol} shares
                      </h3>
                      <p className="mt-1 text-sm text-text-muted">{kind}</p>
                    </div>
                    <div>
                      <p className="text-sm text-text-muted">
                        {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) ? `${kind} date` : 'Ledger date'}
                      </p>
                      <p className="mt-1 text-sm">
                        {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase())
                          ? formatDate(entry.companyEventOn, 'Not recorded')
                          : formatDate(entry.effectiveOn)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-text-muted">Certificate</p>
                      <p className="mt-1 text-sm font-medium">
                        {latest
                          ? MEMBER_CERTIFICATE_STATUS_LABELS[latest.status]
                          : receiving
                            ? 'Not requested'
                            : 'Not applicable'}
                      </p>
                    </div>
                  </div>
                  <Disclosure summary="Record details">
                    <Rows>
                      <Row label="Entry">{entry.sequence}</Row>
                      <Row label="Ledger date">{formatDate(entry.effectiveOn)}</Row>
                      <Row label="Recorded">{formatDateTime(entry.createdAt)}</Row>
                      {latest && <Row label="Requested">{formatDateTime(latest.createdAt)}</Row>}
                      {latest && <Row label="Request">{shortReference(latest.uuid)}</Row>}
                    </Rows>
                    {related.length > 1 && (
                      <div className="divide-y divide-border-subtle">
                        <h4 className="pt-3 text-sm font-medium">Previous requests</h4>
                        {related.slice(1).map(requestRecord)}
                      </div>
                    )}
                  </Disclosure>
                  {(receiving ||
                    latest?.status === 'requested' ||
                    (latest?.status === 'fulfilled' && latest.fulfilment)) && (
                    <FormActions>
                      {receiving && (
                        <PageAction
                          label="Request certificate"
                          context={`${selectedClass?.name ?? 'Shares'}, entry ${entry.sequence}`}
                          busy={running === `certificate:${entry.uuid}`}
                          busyLabel="Requesting…"
                          disabled={held}
                          onClick={() => onRequest(entry.uuid)}
                        />
                      )}
                      {latest && actions(latest)}
                    </FormActions>
                  )}
                </div>
              );
            })}
          </div>
          {otherRequests.length > 0 && (
            <Disclosure summary="Other certificate requests">
              <div className="divide-y divide-border-subtle">{otherRequests.map(requestRecord)}</div>
            </Disclosure>
          )}
        </>
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
