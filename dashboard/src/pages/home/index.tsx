import { CompanyPicker } from '@pages/company/shared/CompanySelection';
import { DESTINATIONS } from '@ledova/shared';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatShareCount,
  useMemberRecords,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { LinkRow, Row, Rows, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { FIELD_CLASS } from '@components/fieldClass';
import { AwardStatus } from '@components/AwardStatus';
import { useMemberCertificateDownload } from './useMemberCertificateDownload';

const SUMMARY = 'cursor-pointer py-2 text-sm font-medium text-text-primary';

export default function MemberRecordsPage() {
  const read = useMemberRecords(() => crypto.randomUUID());
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
  const [historyToken, setHistoryToken] = useState('');
  const history = useRef<HTMLDetailsElement>(null);
  const initialHistory = useRef('');
  const documentsOnly = useLocation().hash === '#documents';
  const held = read.busy || !!read.retry;
  useEffect(() => {
    if (read.record && read.record.uuid !== initialHistory.current && !held) {
      initialHistory.current = read.record.uuid;
      const item = read.record.classes[0];
      if (item) {
        read.selectToken(item.uuid);
      }
    }
  }, [read.record, read.selectToken, held]);
  const historyClass =
    read.record?.classes.find((item) => item.uuid === historyToken)?.name ?? read.record?.classes[0]?.name ?? '';
  const records = read.record ? [read.record] : read.records.length === 1 ? read.records : [];
  const choose = (uuid: string) => {
    if (uuid !== read.record?.uuid) select(uuid);
    setName('');
    setAddress('');
    setConfirmed(false);
  };
  const shareHistory = read.record && (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">Choose a share class to request a certificate for a receiving entry.</p>
      {documentsOnly && (
        <div className="flex flex-wrap gap-2 py-3">
          {read.record.classes.map((item) => (
            <PageAction
              key={item.uuid}
              label={`Read own entries for ${item.name}`}
              disabled={held}
              onClick={() => {
                setHistoryToken(item.uuid);
                read.selectToken(item.uuid);
              }}
            />
          ))}
        </div>
      )}
      {read.entries.map((entry) => (
        <div key={entry.uuid} className="space-y-2 py-3">
          <p className="text-sm">
            Entry {entry.sequence} · {entry.kind} · Ledger {formatDate(entry.effectiveOn)} · Own change {entry.delta}
          </p>
          <p className="text-sm text-text-muted">
            Recorded {formatDateTime(entry.createdAt)}
            {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) && (
              <>
                {' · '}
                <span>Company date {entry.companyEventOn ? formatDate(entry.companyEventOn) : 'Not recorded'}</span>
              </>
            )}
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
    </div>
  );
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
        primary
        disabled={held || !accepted || !/^[A-Za-z0-9_-]{43}$/.test(code)}
        onClick={() => void read.accept(code)}
      />
    </div>
  );
  return (
    <PageTitle.Provider value={documentsOnly ? 'Documents' : 'Dashboard'}>
      <Page
        narrow={documentsOnly}
        lede={
          documentsOnly
            ? 'Your certificates and company-reviewed requests. No wallet is needed.'
            : 'Your company-recorded shares and employee awards. No wallet is needed.'
        }
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
            {read.records.length > 1 && (
              <div className="max-w-md">
                <CompanyPicker
                  companies={read.records.map((record) => ({ uuid: record.uuid, name: record.company.name }))}
                  value={read.record?.uuid ?? ''}
                  disabled={held}
                  onChange={choose}
                />
              </div>
            )}
            {records.map((record) => (
              <div key={record.uuid} className="space-y-4">
                <h2 className="break-words font-display text-xl text-text-primary">{record.company.name}</h2>
                {!documentsOnly && (
                  <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                    <Section title="Your issued shares">
                      {record.classes.length === 0 ? (
                        <p className="text-sm text-text-muted">No issued shares recorded.</p>
                      ) : (
                        <div className="divide-y divide-border-subtle">
                          {record.classes.map((item) => (
                            <div key={item.uuid} className="space-y-3 py-3">
                              <div className="space-y-1">
                                <p className="break-words text-sm text-text-muted">{item.name}</p>
                                <p className="break-words text-2xl font-medium tabular-nums">
                                  {formatShareCount(item.shares)} issued shares
                                </p>
                              </div>
                              {read.record?.uuid === record.uuid && (
                                <PageAction
                                  label={`Read own entries for ${item.name}`}
                                  disabled={held}
                                  onClick={() => {
                                    setHistoryToken(item.uuid);
                                    read.selectToken(item.uuid);
                                    if (history.current) history.current.open = true;
                                  }}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {read.record?.uuid !== record.uuid && (
                        <PageAction
                          label={`Open ${record.company.name} member record`}
                          disabled={held}
                          onClick={() => choose(record.uuid)}
                        />
                      )}
                    </Section>
                    {record.awards.length > 0 && (
                      <Section title="Employee awards">
                        <p className="text-sm text-text-muted">Promised shares are an entitlement until issued.</p>
                        <div className="divide-y divide-border-subtle">
                          {record.awards.map((award) => (
                            <div key={award.uuid} className="space-y-3 py-3">
                              {record.classes.find((item) => item.uuid === award.token) && (
                                <h3 className="break-words text-sm font-medium">
                                  {record.classes.find((item) => item.uuid === award.token)!.name}
                                </h3>
                              )}
                              <AwardStatus {...award} />
                              <details>
                                <summary className={SUMMARY}>Award terms and recorded vesting</summary>
                                <div className="space-y-2 text-sm text-text-muted">
                                  <p>
                                    {formatDate(award.termsOn)} · {award.terms}
                                  </p>
                                  <p className="break-words">{award.schedule}</p>
                                  <p>Dates do not vest an award automatically.</p>
                                  {award.vestings.map((vesting) => (
                                    <p key={vesting.uuid}>
                                      {formatDate(vesting.vestedOn)} · {formatShareCount(vesting.shares)} recorded
                                      vested
                                    </p>
                                  ))}
                                  {award.ends.map((event) => (
                                    <p key={event.uuid}>
                                      {formatDate(event.companyEventOn)} · {formatShareCount(event.unvestedShares)}{' '}
                                      unvested and {formatShareCount(event.vestedShares)} vested unissued rights ended ·{' '}
                                      {event.reason}
                                    </p>
                                  ))}
                                  {award.vestingReversals.map((event) => (
                                    <p key={event.uuid}>
                                      {formatDate(event.companyEventOn)} · {formatShareCount(event.reversedShares)}{' '}
                                      vesting reversed · original {event.vesting} · {event.reason}
                                    </p>
                                  ))}
                                </div>
                              </details>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}
                  </div>
                )}
              </div>
            ))}
            {read.record && (
              <div className={`grid items-start gap-4 ${documentsOnly ? '' : 'xl:grid-cols-2'}`}>
                <Section title="Certificates">
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
                  {read.requests &&
                    !read.requests.certificates.some(
                      (request) => request.status === 'fulfilled' && request.fulfilment,
                    ) && <p className="text-sm text-text-muted">No issued certificates available.</p>}
                  {!read.requests && <p role="status">Loading your documents and requests…</p>}
                  {!documentsOnly && (
                    <LinkRow
                      to={`${DESTINATIONS.home.path}#documents`}
                      label="View documents and certificate requests"
                    />
                  )}
                </Section>
                <Section title={documentsOnly ? 'Share history' : 'Your member record'}>
                  {!documentsOnly && read.entries.length > 0 && (
                    <div className="space-y-2 border-b border-border-subtle pb-3 text-sm">
                      <h3 className="font-medium">Recent changes · {historyClass}</h3>
                      {[...read.entries]
                        .sort((left, right) => right.sequence - left.sequence)
                        .slice(0, 3)
                        .map((entry) => (
                          <p key={entry.uuid} className="text-text-muted">
                            Ledger {formatDate(entry.effectiveOn)} · {entry.kind} · Own change {entry.delta}
                            {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) &&
                              ` · Company date ${entry.companyEventOn ? formatDate(entry.companyEventOn) : 'Not recorded'}`}
                          </p>
                        ))}
                    </div>
                  )}
                  {!documentsOnly && (
                    <details open>
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
                          {item.name} · Entered {formatDate(item.enteredOn, 'Not recorded')}
                          {item.ceasedOn ? ` · Ceased ${formatDate(item.ceasedOn)}` : ''} · Amount paid{' '}
                          {item.amountPaid ?? 'not recorded'}
                        </p>
                      ))}
                    </details>
                  )}
                  {documentsOnly ? (
                    shareHistory
                  ) : (
                    <details ref={history}>
                      <summary className={SUMMARY}>Your share history and certificate requests</summary>
                      {shareHistory}
                    </details>
                  )}
                  {!documentsOnly && (
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
                          primary
                          disabled={held || !confirmed || !name.trim() || !address.trim()}
                          onClick={() => void read.requestParticulars(name.trim(), address.trim())}
                        />
                      </div>
                    </details>
                  )}
                </Section>
                {read.requests && (read.requests.particulars.length > 0 || read.requests.certificates.length > 0) && (
                  <Section title="Your request status">
                    <div className="space-y-3 pt-2 text-sm">
                      {read.requests.particulars.map((request) => (
                        <div key={request.uuid}>
                          <p>Particulars update · {request.status}</p>
                          <details>
                            <summary className={SUMMARY}>Record details</summary>
                            <p className="break-all">
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
                            <p className="break-all">
                              Request {request.uuid} · Entry {request.entry}
                            </p>
                          </details>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
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
  const { busy, error, download } = useMemberCertificateDownload(read, request);
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
