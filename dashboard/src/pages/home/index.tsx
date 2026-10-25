import { CheckboxField, Field, TextArea, TextInput } from '@components/Field';
import { CompanyPicker } from '@components/CompanyPicker';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  FIELD_LIMITS,
  REGISTER_CORRECTION_COPY,
  MEMBER_PARTICULARS_STATUS_LABELS,
  type RegisterEntryKind,
  shortReference,
} from '@ledova/shared';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { formatDate, formatDateTime, shareChange, formatShareCount, useMemberRecords } from '@ledova/shared';
import { Row, Rows, Section, Loading, LoadError, Disclosure } from '@components/Ledger';
import { Confirmation } from '@components/Modal';
import { FormActions, Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { pageTitle } from '@utils/destinations';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { AwardStatus } from '@components/AwardStatus';
import { MemberCertificates } from './MemberCertificates';
import { useMemberFreshness } from './useMemberFreshness';
import { OwnSharesOverview } from './OwnSharesOverview';

export default function MemberRecordsPage() {
  const read = useMemberRecords(() => crypto.randomUUID(), undefined, { coordinatedRefresh: true });
  useMemberFreshness(read);
  const selectionOwner = useRef<ReturnType<typeof useMemberRecords>['owner']>(null);
  useEffect(() => {
    if (read.owner && selectionOwner.current !== read.owner && read.records.length === 1 && !read.busy && !read.retry) {
      selectionOwner.current = read.owner;
      read.select(read.records[0].uuid);
    }
  }, [read.owner, read.records, read.busy, read.retry, read.select]);
  return (
    <MemberRecords
      key={`${read.scopeOwner?.userUuid}/${read.scopeOwner?.ownerAccountUuid}`}
      read={read}
      select={(uuid) => {
        selectionOwner.current = read.owner;
        read.select(uuid);
      }}
    />
  );
}

const entryKind = (kind: string) =>
  REGISTER_CORRECTION_COPY.ENTRY_KINDS[kind.toLowerCase() as RegisterEntryKind] ?? 'Register change';

function MemberRecords({
  read,
  select,
}: {
  read: ReturnType<typeof useMemberRecords>;
  select: (uuid: string) => void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [historyToken, setHistoryToken] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [particularsOpen, setParticularsOpen] = useState(false);
  const initialHistory = useRef('');
  const documentsOnly = useLocation().hash === '#documents';
  const held = read.busy || read.refreshing || read.readFailed || !read.owner || !!read.retry;
  const [withdrawing, setWithdrawing] = useState<{ uuid: string; createdAt: string } | null>(null);
  const { running, track } = useRunningAction();
  const particularsChecks = useErrorSummary({
    name: !name.trim() && 'Give the requested name.',
    address: !address.trim() && 'Give the requested residential address.',
    confirmed: !confirmed && 'Confirm sharing these particulars with the company.',
  });
  useEffect(() => {
    if (read.record && read.record.uuid !== initialHistory.current && !held) {
      const item = read.record.classes[0];
      if (item) {
        initialHistory.current = read.record.uuid;
        read.selectToken(item.uuid);
      }
    }
  }, [read.record, read.selectToken, held]);
  const historyShareClass = read.record?.classes.find((item) => item.uuid === historyToken) ?? read.record?.classes[0];
  const records = !read.readFailed && read.record ? [read.record] : [];
  const pendingParticulars =
    read.requests?.particulars.filter((request) => request.status !== 'applied' && request.status !== 'rejected') ?? [];
  const previousParticulars =
    read.requests?.particulars.filter((request) => request.status === 'applied' || request.status === 'rejected') ?? [];
  const particularsRequests = (requests: NonNullable<typeof read.requests>['particulars']) => (
    <div className="divide-y divide-border-subtle text-sm">
      {requests.map((request) => (
        <div key={request.uuid} className="py-3">
          <p>Particulars update · {MEMBER_PARTICULARS_STATUS_LABELS[request.status]}</p>
          <Disclosure summary="Record details">
            <Rows>
              <Row label="Requested name">{request.name}</Row>
              <Row label="Requested residential address">{request.residentialAddress}</Row>
              <Row label="Request">{shortReference(request.uuid)}</Row>
              {request.change && <Row label="Company instruction">{shortReference(request.change)}</Row>}
            </Rows>
          </Disclosure>
        </div>
      ))}
    </div>
  );
  const choose = (uuid: string) => {
    if (uuid !== read.record?.uuid) {
      initialHistory.current = '';
      setHistoryToken('');
      select(uuid);
    }
    particularsChecks.reset();
    setName('');
    setAddress('');
    setConfirmed(false);
    setParticularsOpen(false);
  };
  const shareHistory = read.record && (
    <div className="divide-y divide-border-subtle">
      {read.record.classes.length === 0 && <p className="text-sm text-text-muted">No share changes yet.</p>}
      {read.entries.map((entry) => (
        <div key={entry.uuid} className="space-y-3 py-3">
          <h3 className="text-sm font-medium">
            {shareChange(entry.delta)} {historyShareClass?.symbol} shares
          </h3>
          <p className="text-sm text-text-muted">
            {entryKind(entry.kind)} ·{' '}
            {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase())
              ? formatDate(entry.companyEventOn, 'Company date not recorded')
              : formatDate(entry.effectiveOn)}
          </p>
          <Disclosure summary="Record details">
            <Rows>
              <Row label="Entry">{entry.sequence}</Row>
              <Row label="Ledger date">{formatDate(entry.effectiveOn)}</Row>
              <Row label="Recorded">{formatDateTime(entry.createdAt)}</Row>
            </Rows>
          </Disclosure>
        </div>
      ))}
    </div>
  );
  return (
    <PageTitle.Provider value={pageTitle('home', documentsOnly ? 'documents' : undefined)}>
      <Page
        lede={
          documentsOnly
            ? 'Your certificates and company-reviewed requests.'
            : 'Your company-recorded shares and employee awards. No wallet is needed.'
        }
      >
        {read.readFailed && (
          <LoadError
            retry={() => {
              setRetrying(true);
              return read.refresh().finally(() => setRetrying(false));
            }}
            busy={retrying || read.busy || read.refreshing}
          >
            Your member records could not be loaded.
          </LoadError>
        )}
        {!read.readFailed && read.error && (
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
        {!read.owner ? (
          <p role="status">Check your signed-in account before opening member records.</p>
        ) : read.loading || retrying || read.refreshing || (read.busy && read.records.length === 0) ? (
          <Loading>Loading member records…</Loading>
        ) : (
          <>
            {read.records.length > 1 && (
              <div className="max-w-md">
                <CompanyPicker
                  companies={read.records.map((record) => ({ uuid: record.uuid, name: record.company.name }))}
                  value={read.record?.uuid ?? ''}
                  disabled={read.busy || read.refreshing || !!read.retry}
                  onChange={choose}
                />
              </div>
            )}
            {records.map((record) => (
              <div key={record.uuid} className="space-y-4">
                <h2 className="break-words font-display text-xl text-text-primary">{record.company.name}</h2>
                {!documentsOnly && (
                  <div className={`grid items-stretch gap-4 ${record.awards.length > 0 ? 'xl:grid-cols-2' : ''}`}>
                    <OwnSharesOverview
                      classes={record.classes}
                      disabled={held}
                      onHistory={(uuid) => {
                        setHistoryToken(uuid);
                        read.selectToken(uuid);
                        setHistoryOpen(true);
                      }}
                    />
                    {record.awards.length > 0 && (
                      <Section title="Employee awards">
                        <div className="divide-y divide-border-subtle">
                          {record.awards.map((award) => (
                            <div key={award.uuid} className="space-y-3 py-3">
                              {record.classes.find((item) => item.uuid === award.token) && (
                                <h3 className="break-words text-sm font-medium">
                                  {record.classes.find((item) => item.uuid === award.token)!.name}
                                </h3>
                              )}
                              <AwardStatus {...award} compact />
                              <Disclosure summary="Award details">
                                <Rows>
                                  <Row label="Company-recorded vested">{formatShareCount(award.vestedShares)}</Row>
                                  <Row label="Unvested">{formatShareCount(award.unvestedRemainingShares)}</Row>
                                  <Row label="Vested, awaiting issue">{formatShareCount(award.availableShares)}</Row>
                                  <Row label="Issued from award">{formatShareCount(award.issuedShares)}</Row>
                                  <Row label="Unvested rights ended">{formatShareCount(award.endedUnvestedShares)}</Row>
                                  <Row label="Vested rights ended">{formatShareCount(award.endedVestedShares)}</Row>
                                  <Row label="Remaining unissued">
                                    {formatShareCount(award.remainingUnissuedShares)}
                                  </Row>
                                </Rows>
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
                                      vesting reversed · original {shortReference(event.vesting)} · {event.reason}
                                    </p>
                                  ))}
                                </div>
                              </Disclosure>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!read.readFailed && !read.record && read.records.length === 1 && (
              <Loading>Loading your company record…</Loading>
            )}
            {read.record && !read.readFailed && (
              <div className="space-y-4">
                {documentsOnly ? (
                  <MemberCertificates
                    read={read}
                    selectedClass={historyShareClass}
                    held={held}
                    running={running}
                    onSelectClass={(uuid) => {
                      setHistoryToken(uuid);
                      read.selectToken(uuid);
                    }}
                    onRequest={(uuid) => track(`certificate:${uuid}`, read.requestCertificate(uuid))}
                    onWithdraw={(request) => setWithdrawing({ uuid: request.uuid, createdAt: request.createdAt })}
                  />
                ) : (
                  <Section title="Your details">
                    <Rows>
                      <Row label="Name">{read.record.name}</Row>
                      <Row label="Residential address">{read.record.residentialAddress}</Row>
                    </Rows>
                    <Disclosure
                      summary="Request a particulars update"
                      open={particularsOpen}
                      onToggle={() => setParticularsOpen((open) => !open)}
                      keepMounted
                    >
                      <div className="space-y-3 pt-2">
                        <p className="text-sm text-text-muted">
                          The company reviews your request. Sending it changes no holding or register particulars.
                        </p>
                        <ErrorSummary {...particularsChecks.summary} />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field {...particularsChecks.field('name')} label="Requested name">
                            <TextInput
                              maxLength={FIELD_LIMITS.NAME}
                              value={name}
                              disabled={held}
                              onChange={(event) => {
                                setName(event.target.value);
                                setConfirmed(false);
                              }}
                            />
                          </Field>
                          <Field {...particularsChecks.field('address')} label="Requested residential address">
                            <TextArea
                              rows={3}
                              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
                              value={address}
                              disabled={held}
                              onChange={(event) => {
                                setAddress(event.target.value);
                                setConfirmed(false);
                              }}
                            />
                          </Field>
                        </div>
                        <CheckboxField
                          {...particularsChecks.field('confirmed')}
                          label="Share these requested particulars with this company for review."
                          checked={confirmed}
                          disabled={held}
                          onChange={(event) => setConfirmed(event.target.checked)}
                        />
                        <FormActions>
                          <PageAction
                            label="Send particulars request"
                            primary
                            busy={running === 'particulars'}
                            busyLabel="Sending request…"
                            disabled={held}
                            onClick={() => {
                              if (particularsChecks.check())
                                track('particulars', read.requestParticulars(name.trim(), address.trim()));
                            }}
                          />
                        </FormActions>
                      </div>
                    </Disclosure>
                    {pendingParticulars.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium">Particulars requests</h3>
                        {particularsRequests(pendingParticulars)}
                      </div>
                    )}
                    {previousParticulars.length > 0 && (
                      <Disclosure summary="Previous particulars requests">
                        {particularsRequests(previousParticulars)}
                      </Disclosure>
                    )}
                    <Disclosure summary="Ledger details">
                      <p className="text-sm text-text-muted">
                        Provided by the company, not verified by Ledova. Profile edits do not change this register.
                      </p>
                      {read.record.classes.map((item) => (
                        <p key={item.uuid} className="py-2 text-sm text-text-muted">
                          {item.name} · Entered {formatDate(item.enteredOn, 'Not recorded')}
                          {item.ceasedOn ? ` · Ceased ${formatDate(item.ceasedOn)}` : ''} · Amount paid{' '}
                          {item.amountPaid ?? 'not recorded'}
                        </p>
                      ))}
                    </Disclosure>
                    <Disclosure
                      summary="Share history"
                      open={historyOpen}
                      onToggle={() => setHistoryOpen((open) => !open)}
                      keepMounted
                    >
                      {shareHistory}
                    </Disclosure>
                  </Section>
                )}
                {documentsOnly && read.requests && read.requests.particulars.length > 0 && (
                  <Section title="Particulars requests">{particularsRequests(read.requests.particulars)}</Section>
                )}
              </div>
            )}
            {!read.error && read.records.length === 0 ? (
              <Section title="Get access to your shares">
                <p className="text-sm text-text-muted">
                  Open the invitation email from your company to see your shares and employee awards here.
                </p>
              </Section>
            ) : null}
          </>
        )}
      </Page>
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
    </PageTitle.Provider>
  );
}
