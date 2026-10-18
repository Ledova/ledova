import { OFFERING_STATUS_TONES } from '@pages/company/shared/statusTones';
import { Row, Rows, Section, Status, SwitchRow } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import {
  OFFERING_EXEMPTION_LABELS,
  OFFERING_PUBLISHED_STATUSES,
  OFFERING_WITHDRAWABLE_STATUSES,
  OFFER_DOCUMENT_COPY,
  createUserFriendlyError,
  formatDate,
  formatMoney,
  formatShareCount,
  useCompanySelection,
  type OfferingListItem,
} from '@ledova/shared';
import { CompanySelection } from '@pages/company/shared/CompanySelection';
import { CompanyReadNotice } from '@pages/company/shared/CompanyState';
import { OfferingDocumentsEditor } from './OfferingDocumentsEditor';
import { OfferingEditor } from './OfferingEditor';
import { SubscriptionsLedger } from './SubscriptionsLedger';
import { useCompanyOfferings } from './useCompanyOfferings';

function OfferingRecord({
  row,
  busy,
  run,
  edit,
  addDocuments,
}: {
  row: OfferingListItem;
  busy: boolean;
  run: (action: 'submit' | 'withdraw' | 'remove', uuid: string) => void;
  edit: () => void;
  addDocuments: () => void;
}) {
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-medium text-text-primary">
          {row.tokenName} ({row.tokenSymbol})
        </h3>
        <Status tone={row.isOpen ? 'done' : (OFFERING_STATUS_TONES.get(row.status) ?? 'closed')}>
          {row.statusDisplay}
        </Status>
      </div>
      <Rows>
        <Row label="Price per share">
          <span className="break-all">{formatMoney(row.pricePerShare, row.priceCurrency)}</span>
        </Row>
        <Row label="Minimum shares">{formatShareCount(String(row.minimumShares))}</Row>
        <Row label="Target shares">{formatShareCount(String(row.targetShares))}</Row>
        <Row label="Cap shares">{formatShareCount(String(row.capShares))}</Row>
        {row.maximumShares !== null && (
          <Row label="Maximum per investor">{formatShareCount(String(row.maximumShares))}</Row>
        )}
        <Row label="Opens">{formatDate(row.opensAt)}</Row>
        <Row label="Closes">{row.closesAt ? formatDate(row.closesAt) : 'No closing date'}</Row>
        <Row label="Exemption">{OFFERING_EXEMPTION_LABELS[row.exemption] ?? row.exemptionDisplay}</Row>
      </Rows>
      {row.status === 'rejected' && row.rejectionReason && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-muted">Rejected: {row.rejectionReason}</p>
      )}
      {row.status === 'withdrawn' && row.rejectionReason && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-muted">
          Previous rejection: {row.rejectionReason}
        </p>
      )}
      {row.closeReason && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-muted">Closed: {row.closeReason}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {row.canBeEdited && (
          <>
            <PageAction
              primary
              label={row.status === 'rejected' ? 'Submit again' : 'Submit for review'}
              disabled={busy}
              onClick={() => run('submit', row.uuid)}
            />
            <PageAction label="Edit" disabled={busy} onClick={edit} />
          </>
        )}
        {OFFERING_WITHDRAWABLE_STATUSES.includes(row.status) && (
          <PageAction label="Withdraw" disabled={busy} onClick={() => run('withdraw', row.uuid)} />
        )}
        {row.canBeDeleted && <PageAction label="Delete" disabled={busy} onClick={() => run('remove', row.uuid)} />}
        {OFFERING_PUBLISHED_STATUSES.includes(row.status) && (
          <PageAction label={OFFER_DOCUMENT_COPY.ADD} disabled={busy} onClick={addDocuments} />
        )}
      </div>
    </li>
  );
}

export default function OfferingPage() {
  const companyRead = useCompanySelection({ ownedOnly: true });
  return (
    <CompanyOfferings key={`${companyRead.scopeKey}/${companyRead.companyUuid ?? ''}`} companyRead={companyRead} />
  );
}

function CompanyOfferings({ companyRead }: { companyRead: ReturnType<typeof useCompanySelection> }) {
  const {
    company,
    data,
    editor,
    setEditor,
    documentsEditor,
    setDocumentsEditor,
    actionError,
    listingPendingRef,
    mounted,
    listing,
    ready,
    run,
  } = useCompanyOfferings({ companyRead });
  return (
    <>
      <Page
        narrow
        loading={companyRead.isLoading || data.isLoading}
        actions={
          <PageAction
            primary
            label="New offering"
            disabled={!ready || !data.tokens.some((token) => token.status === 'deployed')}
            onClick={() => {
              if (ready) setEditor({ company: company.uuid });
            }}
          />
        }
      >
        <CompanySelection read={companyRead} />
        {companyRead.error ? (
          <CompanyReadNotice read={companyRead} />
        ) : !company ? (
          <p className="text-sm text-text-muted">No company found. Please register your company first.</p>
        ) : (
          <>
            <CompanyReadNotice read={companyRead} />
            <CompanyReadNotice read={data} label="Offering information" />
            {actionError && !actionError.listing && (
              <p role="alert" className="text-sm text-error-light">
                {actionError.message}
              </p>
            )}
            {!data.error && (
              <>
                <Section title={`Your offerings (${data.offerings.length})`}>
                  {data.offerings.length === 0 ? (
                    <p className="text-sm text-text-muted">
                      You have no offerings yet. Create one and submit it for review.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {data.offerings.map((row) => (
                        <OfferingRecord
                          key={row.uuid}
                          row={row}
                          busy={!ready}
                          run={(action, uuid) => void run(action, uuid)}
                          edit={() => {
                            if (ready) setEditor({ company: company.uuid, uuid: row.uuid });
                          }}
                          addDocuments={() => {
                            if (ready) setDocumentsEditor({ company: company.uuid, uuid: row.uuid });
                          }}
                        />
                      ))}
                    </ul>
                  )}
                  {!data.tokens.some((token) => token.status === 'deployed') && (
                    <p className="text-sm text-text-muted">
                      Deploy a share class before you offer it. An offering names one deployed share class and the
                      shares it may issue against it.
                    </p>
                  )}
                </Section>
                <SubscriptionsLedger
                  offerings={data.offerings}
                  operatorName={data.operatorName}
                  companyUuid={company.uuid}
                  companyRead={companyRead}
                />
              </>
            )}
            <Section title="Investor Directory">
              <p className="text-sm text-text-muted">
                Your company is listed in the investor directory only while this is on. Nothing is listed by default,
                and a compliance warning, suspension or delisting by {data.operatorName} also hides your company without
                changing this switch. Turning it off hides your share classes; it does not withdraw an offering already
                under review.
              </p>
              <SwitchRow
                label="Show this company to eligible investors"
                checked={company.isOpenToInvestors ?? false}
                disabled={!ready || !company.canIssueTokens || !companyRead.canAdmin}
                onChange={(isOpen) => {
                  if (ready && company.canIssueTokens && companyRead.canAdmin && !listingPendingRef.current) {
                    const uuid = company.uuid;
                    const assertCurrent = companyRead.assertCurrent;
                    const guard = () => {
                      if (!mounted.current) throw createUserFriendlyError('This company action is closed.');
                      assertCurrent(uuid);
                    };
                    listingPendingRef.current = true;
                    listing.mutate({
                      uuid,
                      isOpen,
                      guard,
                      config: { ...companyRead.requestConfig(uuid), ledovaSubmissionGuard: guard },
                    });
                  }
                }}
              />
              {!company.canIssueTokens && (
                <p className="text-sm text-text-muted">
                  Your company must be active before it can be listed. It is currently {company.statusDisplay}.
                </p>
              )}
              {actionError?.listing && (
                <p role="alert" className="text-sm text-error-light">
                  {actionError.message}
                </p>
              )}
            </Section>
            <Section title="What happens next">
              <ol className="list-inside list-decimal space-y-2 text-sm text-text-muted">
                <li>
                  Submit the offering; {data.operatorName} reviews the bounds, the window and the exemption relied on.
                </li>
                <li>Once approved, it opens automatically at the opening time you set.</li>
                <li>Eligible investors see it in the directory and can subscribe.</li>
                <li>
                  It closes only when {data.operatorName} closes it; reaching the cap does not close it on its own.
                </li>
              </ol>
            </Section>
          </>
        )}
      </Page>
      {editor && (
        <OfferingEditor
          key={`${editor.company}:${editor.uuid ?? 'new'}`}
          uuid={editor.uuid}
          targetCompany={editor.company}
          company={company}
          companyRead={companyRead}
          data={data}
          onClose={() => setEditor(null)}
        />
      )}
      {documentsEditor && (
        <OfferingDocumentsEditor
          key={`${documentsEditor.company}:${documentsEditor.uuid}`}
          uuid={documentsEditor.uuid}
          targetCompany={documentsEditor.company}
          company={company}
          companyRead={companyRead}
          data={data}
          onClose={() => setDocumentsEditor(null)}
        />
      )}
    </>
  );
}
