import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DESTINATIONS,
  OFFERING_EXEMPTION_LABELS,
  OFFERING_PUBLISHED_STATUSES,
  OFFERING_WITHDRAWABLE_STATUSES,
  OFFER_DOCUMENT_COPY,
  formatDate,
  formatDateTime,
  formatMoney,
  formatShareCount,
  useCompanySelection,
} from '@ledova/shared';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { Loading, Outcome, Row, Rows, Section, Status } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { CopyButton } from '@components/CopyButton';
import { Confirmation } from '@components/Modal';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { CompanyReadNotice } from '@components/CompanyState';
import { offeringTone } from '@pages/company/shared/statusTones';
import { OfferingEditor } from '@pages/company/offering/shared/OfferingEditor';
import { useCompanyOffering } from '@pages/company/offering/shared/useOffering';
import { useCompanyOfferings } from '@pages/company/offering/shared/useCompanyOfferings';
import { OfferingApplications } from './OfferingApplications';
import { OfferingDocumentsEditor } from './OfferingDocumentsEditor';

interface Confirming {
  action: 'withdraw' | 'remove';
  tokenName: string;
}

export default function CompanyOfferingDetailPage() {
  const { uuid = '' } = useParams();
  const context = useCompanyContext();
  const companyRead = useCompanySelection({
    ownedOnly: true,
    selectedUuid: context ? (context.companyUuid ?? '') : undefined,
  });
  return (
    <CompanyOffering
      key={`${companyRead.scopeKey}/${companyRead.companyUuid ?? ''}/${uuid}`}
      companyRead={companyRead}
      uuid={uuid}
    />
  );
}

function CompanyOffering({ companyRead, uuid }: { companyRead: ReturnType<typeof useCompanySelection>; uuid: string }) {
  const {
    company,
    data,
    editor,
    setEditor,
    documentsEditor,
    setDocumentsEditor,
    actionError,
    ready,
    run,
    notice,
    submitting,
    pending,
  } = useCompanyOfferings({ companyRead });
  const context = useCompanyContext();
  const navigate = useNavigate();
  const listPath = context?.companyPath(DESTINATIONS.companyOffering.path) ?? DESTINATIONS.companyOffering.path;
  const row = data.offerings.find((item) => item.uuid === uuid);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [leaving, setLeaving] = useState(false);
  const detail = useCompanyOffering(uuid, company?.uuid ?? '', companyRead, !!company && !!row && !leaving);
  const offering = row && detail.data?.tokenUuid === row.tokenUuid ? detail.data : undefined;
  const busy = !ready || detail.isFetching;
  const confirm = async ({ action, tokenName }: Confirming) => {
    if (action === 'remove') setLeaving(true);
    const done = await run(action, uuid);
    if (done && action === 'remove') {
      navigate(listPath, {
        replace: true,
        state: { offeringOutcome: `The ${tokenName} draft offering was deleted.` },
      });
      return;
    }
    setLeaving(false);
    setConfirming(null);
  };

  let record: ReactNode = null;
  if (!row || !company)
    record =
      leaving || data.isRefreshing || companyRead.isRefreshing ? (
        <Loading>Loading the offering…</Loading>
      ) : (
        <p className="text-sm text-text-muted">
          This company has no such offering. It may have been deleted, or it may belong to another company.
        </p>
      );
  else if (detail.isError)
    record = (
      <CompanyReadNotice
        read={{ error: detail.error, isRefreshing: detail.isFetching, refetch: detail.refetch }}
        label="This offering"
      />
    );
  else if (!offering) record = <Loading>Loading the offering…</Loading>;
  else {
    const published = OFFERING_PUBLISHED_STATUSES.includes(row.status);
    const payment = [
      ...(offering.acceptsBankTransfer ? ['Bank transfer'] : []),
      ...offering.settlementAssets.map(
        (asset) =>
          data.settlementAssets.find((item) => item.uuid === asset)?.symbol ?? 'A settlement asset no longer offered',
      ),
    ];
    record = (
      <>
        <Section title="Review">
          <Outcome>{notice}</Outcome>
          <Rows>
            <Row label="Status">
              <Status tone={offeringTone(row)}>{row.statusDisplay}</Status>
            </Row>
            <Row label="Created">{formatDateTime(offering.createdAt)}</Row>
            {offering.submittedAt && (
              <Row label="Submitted">
                {formatDateTime(offering.submittedAt)}
                {offering.submittedByEmail && ` by ${offering.submittedByEmail}`}
              </Row>
            )}
            {offering.reviewedAt && <Row label="Reviewed">{formatDateTime(offering.reviewedAt)}</Row>}
            {offering.rejectionReason && (row.status === 'rejected' || row.status === 'withdrawn') && (
              <Row label={row.status === 'rejected' ? 'Rejection reason' : 'Previous rejection'}>
                <span className="whitespace-pre-wrap">{offering.rejectionReason}</span>
              </Row>
            )}
            {offering.closedAt && (row.status === 'closed' || row.status === 'withdrawn') && (
              <Row label={row.status === 'closed' ? 'Closed' : 'Withdrawn'}>{formatDateTime(offering.closedAt)}</Row>
            )}
            {offering.closeReason && row.status === 'closed' && (
              <Row label="Closing reason">
                <span className="whitespace-pre-wrap">{offering.closeReason}</span>
              </Row>
            )}
          </Rows>
          {actionError && !actionError.listing && (
            <p role="alert" className="text-sm text-error-light">
              {actionError.message}
            </p>
          )}
          {(OFFERING_WITHDRAWABLE_STATUSES.includes(row.status) || row.canBeDeleted || row.canBeEdited) && (
            <FormActions>
              {OFFERING_WITHDRAWABLE_STATUSES.includes(row.status) && (
                <PageAction
                  label="Withdraw"
                  disabled={busy}
                  onClick={() => {
                    if (ready) setConfirming({ action: 'withdraw', tokenName: row.tokenName });
                  }}
                />
              )}
              {row.canBeDeleted && (
                <PageAction
                  label="Delete"
                  disabled={busy}
                  onClick={() => {
                    if (ready) setConfirming({ action: 'remove', tokenName: row.tokenName });
                  }}
                />
              )}
              {row.canBeEdited && (
                <PageAction
                  primary
                  label={row.status === 'rejected' ? 'Submit again' : 'Submit for review'}
                  disabled={busy}
                  busy={submitting === uuid}
                  busyLabel="Submitting…"
                  onClick={() => void run('submit', uuid)}
                />
              )}
            </FormActions>
          )}
        </Section>
        <Section title="Terms">
          <Rows>
            <Row label="Price per share">{formatMoney(offering.pricePerShare, offering.priceCurrency)}</Row>
            <Row label="Minimum shares">{formatShareCount(String(offering.minimumShares))}</Row>
            <Row label="Target shares">{formatShareCount(String(offering.targetShares))}</Row>
            <Row label="Cap shares">{formatShareCount(String(offering.capShares))}</Row>
            {offering.maximumShares !== null && (
              <Row label="Maximum per investor">{formatShareCount(String(offering.maximumShares))}</Row>
            )}
            <Row label="Opens">{formatDateTime(offering.opensAt)}</Row>
            <Row label="Closes">{offering.closesAt ? formatDateTime(offering.closesAt) : 'No closing date'}</Row>
            <Row label="Exemption">{OFFERING_EXEMPTION_LABELS[offering.exemption] ?? offering.exemptionDisplay}</Row>
            <Row label="How investors may pay">{payment.length > 0 ? payment.join(', ') : 'Not set'}</Row>
            {offering.summary && (
              <Row label="Summary">
                <span className="whitespace-pre-wrap">{offering.summary}</span>
              </Row>
            )}
            {offering.useOfProceeds && (
              <Row label="Use of proceeds">
                <span className="whitespace-pre-wrap">{offering.useOfProceeds}</span>
              </Row>
            )}
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
          {row.canBeEdited && (
            <FormActions>
              <PageAction
                label="Edit"
                disabled={busy}
                onClick={() => {
                  if (ready) setEditor({ company: company.uuid, uuid });
                }}
              />
            </FormActions>
          )}
        </Section>
        {(published || offering.documents.length > 0) && (
          <Section title={OFFER_DOCUMENT_COPY.ATTACH_HEADING}>
            {offering.documents.length === 0 ? (
              <p className="text-sm text-text-muted">{OFFER_DOCUMENT_COPY.EMPTY}</p>
            ) : (
              <ul className="divide-y divide-border-subtle text-sm">
                {offering.documents.map((attached) => {
                  const document = company.documents.find((item) => item.uuid === attached);
                  return (
                    <li key={attached} className="py-3">
                      <p className="break-all text-text-primary">{document?.name ?? 'Attached document'}</p>
                      {document && <p className="text-text-muted">{document.documentTypeDisplay}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {published && (
              <FormActions>
                <PageAction
                  label={OFFER_DOCUMENT_COPY.ADD}
                  disabled={busy}
                  onClick={() => {
                    if (ready) setDocumentsEditor({ company: company.uuid, uuid });
                  }}
                />
              </FormActions>
            )}
          </Section>
        )}
        {published && (
          <OfferingApplications
            offering={row}
            operatorName={data.operatorName}
            companyUuid={company.uuid}
            companyRead={companyRead}
          />
        )}
      </>
    );
  }

  return (
    <PageTitle.Provider value={row && offering ? row.tokenName : DESTINATIONS.companyOfferingDetail.title}>
      <Page
        documentTitle={DESTINATIONS.companyOfferingDetail.title}
        back={{ to: listPath }}
        lede={row && offering ? `Offering · ${row.tokenSymbol} · created ${formatDate(row.createdAt)}` : undefined}
        loading={companyRead.isLoading || data.isLoading}
      >
        {companyRead.error ? (
          <CompanyReadNotice read={companyRead} />
        ) : !company ? (
          <CompanyContextNotice />
        ) : (
          <>
            <CompanyReadNotice read={companyRead} />
            <CompanyReadNotice read={data} label="Offering information" />
            {!data.error && record}
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
          busy={pending === confirming.action || leaving}
          busyLabel={confirming.action === 'withdraw' ? 'Withdrawing…' : 'Deleting…'}
          onClose={() => setConfirming(null)}
          onConfirm={() => void confirm(confirming)}
        >
          {confirming.action === 'withdraw'
            ? `The ${confirming.tokenName} offering stays visible as a record and can no longer be edited, resubmitted or deleted.`
            : `The ${confirming.tokenName} draft offering is deleted. This can't be undone.`}
        </Confirmation>
      )}
    </PageTitle.Provider>
  );
}
