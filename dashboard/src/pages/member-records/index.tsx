import { useEffect, useRef, useState } from 'react';
import {
  formatDate,
  formatShareCount,
  useMemberRecords,
  getMemberCertificateFile,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { saveFile } from '../company/register/useCompanyRegister';

const SUMMARY = 'cursor-pointer py-2 text-sm font-medium text-text-primary';

export default function MemberRecordsPage() {
  const read = useMemberRecords(apiClient, () => crypto.randomUUID());
  const selectionOwner = useRef<ReturnType<typeof useMemberRecords>['owner']>(null);
  useEffect(() => {
    if (read.owner && selectionOwner.current !== read.owner && read.records.length === 1 && !read.busy && !read.retry) {
      selectionOwner.current = read.owner;
      read.select(read.records[0].uuid);
    }
  }, [read.owner, read.records, read.busy, read.retry, read.select]);
  return (
    <MemberRecords
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}`}
      read={read}
      select={(uuid) => {
        selectionOwner.current = read.owner;
        read.select(uuid);
      }}
    />
  );
}

function MemberRecords({
  read,
  select,
}: {
  read: ReturnType<typeof useMemberRecords>;
  select: (uuid: string) => void;
}) {
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const history = useRef<HTMLDetailsElement>(null);
  const held = read.busy || !!read.retry;
  const invitation = (
    <div className="space-y-3 pt-2">
      <p className="text-sm text-text-muted">
        Use the one-time code privately supplied by the company for your confirmed email. It grants access to your
        member record, not company administration.
      </p>
      <label className="block space-y-1 text-sm">
        Member invitation code
        <input
          className={FIELD_CLASS}
          autoComplete="off"
          value={code}
          disabled={held}
          onChange={(event) => {
            setCode(event.target.value);
            setAccepted(false);
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={accepted}
          disabled={held}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        I accept access to the company&apos;s invited member record using my signed-in account.
      </label>
      <PageAction
        label="Accept member invitation"
        disabled={held || !accepted || !/^[A-Za-z0-9_-]{43}$/.test(code)}
        onClick={() => void read.accept(code)}
      />
    </div>
  );
  return (
    <PageTitle.Provider value="Dashboard">
      <Page
        lede="Your company-recorded shares and employee awards. No wallet is needed."
        actions={
          <PageAction
            label="Refresh member records"
            disabled={read.busy || refreshing}
            onClick={() => {
              setRefreshing(true);
              void read.refresh().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {read.error && (
          <p role="alert" className="text-sm text-error-light">
            {read.error}
          </p>
        )}
        {read.retry && (
          <PageAction label="Retry original member action" disabled={read.busy} onClick={() => void read.recover()} />
        )}
        {!read.owner ? (
          <p role="status">Check your signed-in account before opening member records.</p>
        ) : read.loading || refreshing || (read.busy && read.records.length === 0) ? (
          <p role="status">Loading member records…</p>
        ) : (
          <>
            {read.records.map((record) => (
              <Section key={record.uuid} title={record.company.name}>
                {record.classes.length === 0 ? (
                  <p className="text-sm text-text-muted">No issued shares recorded.</p>
                ) : (
                  record.classes.map((item) => (
                    <div key={item.uuid} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div>
                        <p className="text-base text-text-primary">{item.name}</p>
                        <p className="text-2xl tabular-nums text-text-primary">
                          {formatShareCount(item.shares)} issued shares
                        </p>
                      </div>
                      {read.record?.uuid === record.uuid && (
                        <PageAction
                          label={`Read own entries for ${item.name}`}
                          disabled={held}
                          onClick={() => {
                            read.selectToken(item.uuid);
                            if (history.current) history.current.open = true;
                          }}
                        />
                      )}
                    </div>
                  ))
                )}
                {record.awards.length > 0 && (
                  <div className="space-y-2 border-t border-border-subtle pt-3">
                    <h3 className="text-base font-medium">Employee awards</h3>
                    <p className="text-sm text-text-muted">
                      Promised and recorded vested shares are separate from issued shares.
                    </p>
                    {record.awards.map((award) => (
                      <div key={award.uuid} className="space-y-1 py-2">
                        <p className="text-sm tabular-nums">
                          {formatShareCount(award.shares)} awarded · {formatShareCount(award.vestedShares)} vested ·{' '}
                          {formatShareCount(award.issuedShares)} issued · {formatShareCount(award.availableShares)}{' '}
                          available
                        </p>
                        <details>
                          <summary className={SUMMARY}>Award terms and recorded vesting</summary>
                          <div className="space-y-2 text-sm text-text-muted">
                            <p>
                              {formatDate(award.termsOn)} · {award.terms}
                            </p>
                            <p>{award.schedule}</p>
                            <p>Dates do not vest an award automatically.</p>
                            {award.vestings.map((vesting) => (
                              <p key={vesting.uuid}>
                                {formatDate(vesting.vestedOn)} · {formatShareCount(vesting.shares)} recorded vested
                              </p>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
                <PageAction
                  label={`Open ${record.company.name} member record`}
                  active={read.record?.uuid === record.uuid}
                  disabled={held}
                  onClick={() => {
                    select(record.uuid);
                    setName('');
                    setAddress('');
                    setConfirmed(false);
                  }}
                />
              </Section>
            ))}
            {read.record && (
              <Section title="Documents and member details">
                {read.requests?.certificates.some(
                  (request) => request.status === 'fulfilled' && request.fulfilment,
                ) && (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted">
                      Your unsigned certificates. The company remains responsible for execution.
                    </p>
                    {read.requests.certificates
                      .filter((request) => request.status === 'fulfilled' && request.fulfilment)
                      .map((request) => (
                        <div key={request.uuid} className="space-y-1">
                          <p className="text-sm">Certificate requested {formatDate(request.createdAt)}</p>
                          <MemberCertificateDownload read={read} request={request} />
                        </div>
                      ))}
                  </div>
                )}
                <details>
                  <summary className={SUMMARY}>Company-recorded particulars</summary>
                  <p className="text-sm text-text-muted">
                    Provided by the company, not verified by Ledova. Profile edits do not change this register.
                  </p>
                  <Rows>
                    <Row label="Member">{read.record.name}</Row>
                    <Row label="Residential address">{read.record.residentialAddress}</Row>
                  </Rows>
                  {read.record.classes.map((item) => (
                    <p key={item.uuid} className="py-2 text-sm text-text-muted">
                      {item.name} · Entered {item.enteredOn ?? 'not recorded'}
                      {item.ceasedOn ? ` · Ceased ${item.ceasedOn}` : ''} · Amount paid{' '}
                      {item.amountPaid ?? 'not recorded'}
                    </p>
                  ))}
                </details>
                <details ref={history}>
                  <summary className={SUMMARY}>Your share history and certificate requests</summary>
                  <p className="text-sm text-text-muted">
                    Read the own entries for a share class above to request a certificate for a receiving entry.
                  </p>
                  {read.entries.map((entry) => (
                    <div key={entry.uuid} className="space-y-2 py-3">
                      <p className="text-sm">
                        Entry {entry.sequence} · {entry.kind} · {formatDate(entry.effectiveOn)} · Own change{' '}
                        {entry.delta}
                      </p>
                      {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) && BigInt(entry.delta) > 0n && (
                        <PageAction
                          label={`Request certificate for entry ${entry.sequence}`}
                          disabled={held}
                          onClick={() => void read.requestCertificate(entry.uuid)}
                        />
                      )}
                    </div>
                  ))}
                </details>
                <details>
                  <summary className={SUMMARY}>Request a particulars update</summary>
                  <div className="space-y-3 pt-2">
                    <p className="text-sm text-text-muted">
                      The company reviews your request. Sending it changes no holding or register particulars.
                    </p>
                    <label className="block space-y-1 text-sm">
                      Requested name
                      <input
                        className={FIELD_CLASS}
                        value={name}
                        disabled={held}
                        onChange={(event) => {
                          setName(event.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <label className="block space-y-1 text-sm">
                      Requested residential address
                      <textarea
                        className={FIELD_CLASS}
                        value={address}
                        disabled={held}
                        onChange={(event) => {
                          setAddress(event.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={held}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      Share these requested particulars with this company for review.
                    </label>
                    <PageAction
                      label="Send particulars request"
                      disabled={held || !confirmed || !name.trim() || !address.trim()}
                      onClick={() => void read.requestParticulars(name.trim(), address.trim())}
                    />
                  </div>
                </details>
                {read.requests && (read.requests.particulars.length > 0 || read.requests.certificates.length > 0) && (
                  <details>
                    <summary className={SUMMARY}>Your request status</summary>
                    <div className="space-y-3 pt-2 text-sm">
                      {read.requests.particulars.map((request) => (
                        <div key={request.uuid}>
                          <p>Particulars update · {request.status}</p>
                          <details>
                            <summary className={SUMMARY}>Record details</summary>
                            <p>
                              Request {request.uuid}
                              {request.change ? ` · Company instruction ${request.change}` : ''}
                            </p>
                          </details>
                        </div>
                      ))}
                      {read.requests.certificates.map((request) => (
                        <div key={request.uuid} className="space-y-2">
                          <p>
                            Certificate requested {formatDate(request.createdAt)} · {request.status}
                          </p>
                          {request.status === 'requested' && (
                            <PageAction
                              label="Withdraw certificate request"
                              context={request.createdAt}
                              disabled={held}
                              onClick={() => void read.withdraw(request.uuid)}
                            />
                          )}
                          <details>
                            <summary className={SUMMARY}>Record details</summary>
                            <p>
                              Request {request.uuid} · Entry {request.entry}
                            </p>
                          </details>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Section>
            )}
            {!read.error && read.records.length === 0 ? (
              <Section title="Get access to your shares">
                <p className="text-sm text-text-muted">
                  Accept your company&apos;s invitation to see your shares and employee awards here.
                </p>
                {invitation}
              </Section>
            ) : (
              <details className="rounded-xl border border-border p-4">
                <summary className={SUMMARY}>Accept another member invitation</summary>
                {invitation}
              </details>
            )}
          </>
        )}
      </Page>
    </PageTitle.Provider>
  );
}

function MemberCertificateDownload({
  read,
  request,
}: {
  read: ReturnType<typeof useMemberRecords>;
  request: MemberCertificateRequest;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const captured = read.guardCertificate(request.uuid);
      const check = () => {
        const current = read.guardCertificate(request.uuid);
        if (
          current.uuid !== captured.uuid ||
          current.digest !== captured.digest ||
          current.fileSize !== captured.fileSize
        )
          throw new Error('The certificate fulfilment changed. Refresh your records.');
      };
      check();
      const { data } = await getMemberCertificateFile(apiClient, request.uuid, { ledovaSubmissionGuard: check });
      check();
      if (!(data instanceof Blob) || !/^application\/pdf(?:;|$)/.test(data.type) || data.size !== captured.fileSize)
        throw new Error('The recipient certificate PDF could not be confirmed.');
      const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
      check();
      if (
        Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('') !== captured.digest
      )
        throw new Error('The recipient certificate digest does not match its retained record.');
      saveFile(data, `member-certificate-${request.uuid}.pdf`);
    } catch {
      setError('The certificate could not be downloaded. Refresh your current member records.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageAction
        label="Download unsigned certificate"
        context={request.createdAt}
        disabled={busy || read.busy || !!read.retry}
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
