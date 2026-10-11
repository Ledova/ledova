import { useState } from 'react';
import {
  formatShareCount,
  useMemberRecords,
  getMemberCertificateFile,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { saveFile } from '../company/register/useCompanyRegister';

export default function MemberRecordsPage() {
  const read = useMemberRecords(apiClient, () => crypto.randomUUID());
  return <MemberRecords key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}`} read={read} />;
}

function MemberRecords({ read }: { read: ReturnType<typeof useMemberRecords> }) {
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const held = read.busy || !!read.retry;
  return (
    <Page lede="The company records these particulars and holdings. Member access gives no company appointment and needs no wallet.">
      <PageAction label="Refresh member records" disabled={read.busy} onClick={() => void read.refresh()} />
      {read.error && (
        <p role="alert" className="text-sm text-error-light">
          {read.error}
        </p>
      )}
      {!read.owner ? (
        <p>Check your signed-in account before opening member records.</p>
      ) : (
        <>
          <Section title="Accept a member invitation">
            <p className="text-sm text-text-muted">
              Use the one-time code privately supplied by the company for your confirmed email. It grants access to that
              member&apos;s records, not company administration.
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
          </Section>
          {read.retry && (
            <PageAction label="Retry original member action" disabled={read.busy} onClick={() => void read.recover()} />
          )}
          <Section title="Your member records">
            {read.loading ? (
              <p role="status">Loading member records…</p>
            ) : read.records.length === 0 ? (
              <p>No currently associated member records are available.</p>
            ) : (
              read.records.map((record) => (
                <PageAction
                  key={record.uuid}
                  label={`Open ${record.company.name} member record`}
                  disabled={held}
                  onClick={() => {
                    read.select(record.uuid);
                    setName('');
                    setAddress('');
                    setConfirmed(false);
                  }}
                />
              ))
            )}
          </Section>
          {read.record && (
            <>
              <Section title={read.record.company.name}>
                <p className="text-sm text-text-muted">
                  Particulars provided by the company; not verified by Ledova. Profile edits do not change this
                  register.
                </p>
                <Rows>
                  <Row label="Member">{read.record.name}</Row>
                  <Row label="Residential address">{read.record.residentialAddress}</Row>
                </Rows>
                {read.record.classes.map((item) => (
                  <div key={item.uuid} className="space-y-2 py-3">
                    <p>
                      {item.name} · {formatShareCount(item.shares)} issued shares
                    </p>
                    <p className="text-sm text-text-muted">
                      Entered {item.enteredOn ?? 'not recorded'}
                      {item.ceasedOn ? ` · Ceased ${item.ceasedOn}` : ''} · Amount paid{' '}
                      {item.amountPaid ?? 'not recorded'}
                    </p>
                    <PageAction
                      label={`Read own entries for ${item.name}`}
                      disabled={held}
                      onClick={() => read.selectToken(item.uuid)}
                    />
                  </div>
                ))}
                {read.entries.map((entry) => (
                  <div key={entry.uuid} className="space-y-2 py-3">
                    <p>
                      Entry {entry.sequence} · {entry.kind} · {entry.effectiveOn} · Own change {entry.delta}
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
              </Section>
              <Section title="Your employee awards">
                <p className="text-sm text-text-muted">
                  Awards are promised entitlements. Recorded vesting is separate from issued shares; dates do not vest
                  an award automatically.
                </p>
                {read.record.awards.length === 0 ? (
                  <p>No employee awards recorded.</p>
                ) : (
                  read.record.awards.map((award) => (
                    <div key={award.uuid} className="space-y-1 py-3">
                      <p>
                        {formatShareCount(award.shares)} awarded · {formatShareCount(award.vestedShares)} vested ·{' '}
                        {formatShareCount(award.issuedShares)} issued · {formatShareCount(award.availableShares)}{' '}
                        available
                      </p>
                      <p>
                        {award.termsOn} · {award.terms}
                      </p>
                      <p>{award.schedule}</p>
                      {award.vestings.map((vesting) => (
                        <p key={vesting.uuid}>
                          {vesting.vestedOn} · {formatShareCount(vesting.shares)} recorded vested
                        </p>
                      ))}
                    </div>
                  ))
                )}
              </Section>
              <Section title="Request a register particulars change">
                <p className="text-sm text-text-muted">
                  The company reviews your request and prepares a separate evidenced instruction. Sending this request
                  changes no holding or register particulars.
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
              </Section>
              {read.requests && (
                <Section title="Your request status">
                  {read.requests.particulars.map((request) => (
                    <p key={request.uuid}>
                      Particulars request {request.uuid} · {request.status}
                      {request.change ? ` · Company instruction ${request.change}` : ''}
                    </p>
                  ))}
                  <p className="text-sm text-text-muted">
                    A request creates no certificate. A fulfilled request provides an unsigned PDF of your own receiving
                    entry only; the company is responsible for its execution.
                  </p>
                  {read.requests.certificates.map((request) => (
                    <div key={request.uuid} className="space-y-2 py-3">
                      <p>
                        Certificate request {request.uuid} · {request.status} · Entry {request.entry}
                      </p>
                      {request.status === 'fulfilled' && request.fulfilment && (
                        <MemberCertificateDownload read={read} request={request} />
                      )}
                      {request.status === 'requested' && (
                        <PageAction
                          label={`Withdraw certificate request ${request.uuid}`}
                          disabled={held}
                          onClick={() => void read.withdraw(request.uuid)}
                        />
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </>
      )}
    </Page>
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
        label={`Download own unsigned certificate ${request.uuid}`}
        disabled={busy || read.busy}
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
