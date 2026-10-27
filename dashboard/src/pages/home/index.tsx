import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { formatDate, formatShareCount, shortReference } from '@ledova/shared';
import { Disclosure, Row, Rows, Section } from '@components/Ledger';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { Confirmation } from '@components/Modal';
import { AwardStatus } from '@components/AwardStatus';
import { MemberRecordsContent } from '@components/member-records/MemberRecordsContent';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useRunningAction } from '@hooks/useRunningAction';
import { pageTitle } from '@utils/destinations';
import { MemberCertificates } from './MemberCertificates';
import { OwnSharesOverview } from './OwnSharesOverview';
import { MemberCompanyOwnership } from './MemberCompanyOwnership';
import { MemberOwnershipHeader } from './MemberOwnershipHeader';
import { sharedMemberOwnership } from './memberOwnership';

export default function MemberRecordsPage() {
  const { read } = useMemberWorkspace();
  return (
    <MemberRecordPage key={`${read.scopeOwner?.userUuid}/${read.scopeOwner?.ownerAccountUuid}/${read.selectedUuid}`} />
  );
}

function MemberRecordPage() {
  const { read, held, token, selectToken } = useMemberWorkspace();
  const record = read.record;
  const ownership = record ? sharedMemberOwnership(record) : null;
  const documentsOnly = useLocation().hash === '#documents';
  const selectedClass = record?.classes.find((item) => item.uuid === token) ?? record?.classes[0];
  const [withdrawing, setWithdrawing] = useState<{ uuid: string; createdAt: string } | null>(null);
  const [companyView, setCompanyView] = useState(false);
  const showCompany = companyView && !!ownership;
  const { running, track } = useRunningAction();
  if (companyView && ((record && !ownership) || read.readFailed)) setCompanyView(false);
  return (
    <PageTitle.Provider value={pageTitle('home', documentsOnly ? 'documents' : undefined)}>
      <Page
        lede={
          documentsOnly
            ? 'Your share history and certificates.'
            : 'Your company-recorded shares and employee awards. No wallet is needed.'
        }
      >
        <MemberRecordsContent actions={documentsOnly} companyHeader={documentsOnly}>
          {record &&
            (documentsOnly ? (
              <MemberCertificates
                read={read}
                selectedClass={selectedClass}
                held={held}
                running={running}
                onSelectClass={selectToken}
                onRequest={(uuid) => track(`certificate:${uuid}`, read.requestCertificate(uuid))}
                onWithdraw={(request) => setWithdrawing({ uuid: request.uuid, createdAt: request.createdAt })}
              />
            ) : (
              <>
                <Section
                  title={record.company.name}
                  header={
                    <MemberOwnershipHeader
                      companyView={showCompany}
                      shared={!!ownership}
                      onChangeView={setCompanyView}
                    />
                  }
                >
                  {showCompany && ownership ? (
                    <MemberCompanyOwnership key={record.uuid} ownership={ownership} />
                  ) : (
                    <OwnSharesOverview classes={record.classes} />
                  )}
                </Section>
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
                              <Row label="Remaining unissued">{formatShareCount(award.remainingUnissuedShares)}</Row>
                            </Rows>
                            <div className="space-y-2 text-sm text-text-muted">
                              <p>
                                {formatDate(award.termsOn)} · {award.terms}
                              </p>
                              <p className="break-words">{award.schedule}</p>
                              <p>Dates do not vest an award automatically.</p>
                              {award.vestings.map((vesting) => (
                                <p key={vesting.uuid}>
                                  {formatDate(vesting.vestedOn)} · {formatShareCount(vesting.shares)} recorded vested
                                </p>
                              ))}
                              {award.ends.map((event) => (
                                <p key={event.uuid}>
                                  {formatDate(event.companyEventOn)} · {formatShareCount(event.unvestedShares)} unvested
                                  and {formatShareCount(event.vestedShares)} vested unissued rights ended ·{' '}
                                  {event.reason}
                                </p>
                              ))}
                              {award.vestingReversals.map((event) => (
                                <p key={event.uuid}>
                                  {formatDate(event.companyEventOn)} · {formatShareCount(event.reversedShares)} vesting
                                  reversed · original {shortReference(event.vesting)} · {event.reason}
                                </p>
                              ))}
                            </div>
                          </Disclosure>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            ))}
        </MemberRecordsContent>
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
