import { useCompanyContext } from '@hooks/useCompanyContext';
import { useState } from 'react';
import { OFFERING_STATUS_TONES } from '@pages/company/shared/statusTones';
import { Disclosure, Outcome, Row, Rows, Section, Status, SwitchRow } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import { CopyButton } from '@components/CopyButton';
import { Confirmation } from '@components/Modal';
import {
  OFFERING_EXEMPTION_LABELS,
  OFFERING_PUBLISHED_STATUSES,
  OFFERING_WITHDRAWABLE_STATUSES,
  OFFER_DOCUMENT_COPY,
  createUserFriendlyError,
  formatMoney,
  formatShareCount,
  useCompanySelection,
  type OfferingListItem,
  formatDateTime,
} from '@ledova/shared';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { CompanyReadNotice } from '@components/CompanyState';
import { OfferingDocumentsEditor } from './OfferingDocumentsEditor';
import { OfferingEditor } from './OfferingEditor';
import { SubscriptionsLedger } from './SubscriptionsLedger';
import { useCompanyOfferings } from './useCompanyOfferings';

function OfferingRecord({
  row,
  busy,
  submitting,
  run,
  confirm,
  edit,
  addDocuments,
}: {
  row: OfferingListItem;
  busy: boolean;
  submitting: boolean;
  run: (action: 'submit' | 'withdraw' | 'remove', uuid: string) => void;
  confirm: (action: 'withdraw' | 'remove') => void;
  edit: () => void;
  addDocuments: () => void;
}) {
  return (
    <li className="space-y-3 py-3">
      <Disclosure
        summary={
          <span className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium text-text-primary">
                {row.tokenName} ({row.tokenSymbol})
              </span>
              <span className="block break-words text-sm tabular-nums text-text-muted">
                {formatMoney(row.pricePerShare, row.priceCurrency)} per share
              </span>
            </span>
            <Status tone={row.isOpen ? 'done' : (OFFERING_STATUS_TONES.get(row.status) ?? 'closed')}>
              {row.statusDisplay}
            </Status>
          </span>
        }
      >
        <Rows>
          <Row label="Minimum shares">{formatShareCount(String(row.minimumShares))}</Row>
          <Row label="Target shares">{formatShareCount(String(row.targetShares))}</Row>
          <Row label="Cap shares">{formatShareCount(String(row.capShares))}</Row>
          {row.maximumShares !== null && (
            <Row label="Maximum per investor">{formatShareCount(String(row.maximumShares))}</Row>
          )}
          <Row label="Opens">{formatDateTime(row.opensAt)}</Row>
          <Row label="Closes">{row.closesAt ? formatDateTime(row.closesAt) : 'No closing date'}</Row>
          <Row label="Exemption">{OFFERING_EXEMPTION_LABELS[row.exemption] ?? row.exemptionDisplay}</Row>
          {row.status === 'approved' && (
            <Row label="Offering ID">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 break-all">{row.uuid}</span>
                <CopyButton key={row.uuid} value={row.uuid} label="Copy offering ID" />
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Give this to investors for their large-investment eligibility requests.
              </p>
            </Row>
          )}
        </Rows>
      </Disclosure>
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
      <FormActions>
        {row.canBeEdited && <PageAction label="Edit" disabled={busy} onClick={edit} />}
        {OFFERING_WITHDRAWABLE_STATUSES.includes(row.status) && (
          <PageAction label="Withdraw" disabled={busy} onClick={() => confirm('withdraw')} />
        )}
        {row.canBeDeleted && <PageAction label="Delete" disabled={busy} onClick={() => confirm('remove')} />}
        {OFFERING_PUBLISHED_STATUSES.includes(row.status) && (
          <PageAction label={OFFER_DOCUMENT_COPY.ADD} disabled={busy} onClick={addDocuments} />
        )}
        {row.canBeEdited && (
          <PageAction
            primary
            label={row.status === 'rejected' ? 'Submit again' : 'Submit for review'}
            disabled={busy}
            busy={submitting}
            busyLabel="Submitting…"
            onClick={() => run('submit', row.uuid)}
          />
        )}
      </FormActions>
    </li>
  );
}

export default function OfferingPage() {
  const context = useCompanyContext();
  const companyRead = useCompanySelection({
    ownedOnly: true,
    selectedUuid: context ? (context.companyUuid ?? '') : undefined,
  });
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
    notice,
    submitting,
    pending,
  } = useCompanyOfferings({ companyRead });
  const [confirming, setConfirming] = useState<{ action: 'withdraw' | 'remove'; row: OfferingListItem } | null>(null);
  return (
    <>
      <Page loading={companyRead.isLoading || data.isLoading}>
        {companyRead.error ? (
          <CompanyReadNotice read={companyRead} />
        ) : !company ? (
          <CompanyContextNotice />
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
                  <Outcome>{notice}</Outcome>
                  {data.offerings.length === 0 ? (
                    <p className="text-sm text-text-muted">No offerings yet. Create one and submit it for review.</p>
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {data.offerings.map((row) => (
                        <OfferingRecord
                          key={row.uuid}
                          row={row}
                          busy={!ready}
                          submitting={submitting === row.uuid}
                          run={(action, uuid) => void run(action, uuid)}
                          confirm={(action) => {
                            if (ready) setConfirming({ action, row });
                          }}
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
                <FormActions>
                  <PageAction
                    primary
                    label="New offering"
                    disabled={!ready || !data.tokens.some((token) => token.status === 'deployed')}
                    onClick={() => {
                      if (ready) setEditor({ company: company.uuid });
                    }}
                  />
                </FormActions>
                <SubscriptionsLedger
                  offerings={data.offerings}
                  operatorName={data.operatorName}
                  companyUuid={company.uuid}
                  companyRead={companyRead}
                />
              </>
            )}
            <Section title="Investor directory">
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
      {confirming && (
        <Confirmation
          isOpen
          title={confirming.action === 'withdraw' ? 'Withdraw this offering?' : 'Delete this draft offering?'}
          confirmLabel={confirming.action === 'withdraw' ? 'Withdraw offering' : 'Delete offering'}
          confirmDisabled={!ready}
          busy={pending === confirming.action}
          busyLabel={confirming.action === 'withdraw' ? 'Withdrawing…' : 'Deleting…'}
          onClose={() => setConfirming(null)}
          onConfirm={() => void run(confirming.action, confirming.row.uuid).finally(() => setConfirming(null))}
        >
          {confirming.action === 'withdraw'
            ? `The ${confirming.row.tokenName} offering stays visible as a record and can no longer be edited, resubmitted or deleted.`
            : `The ${confirming.row.tokenName} draft offering is deleted. This can't be undone.`}
        </Confirmation>
      )}
    </>
  );
}
