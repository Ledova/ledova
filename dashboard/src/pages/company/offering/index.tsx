import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  OFFERING_EXEMPTION_LABELS,
  OFFERING_WITHDRAWABLE_STATUSES,
  apiErrorSentence,
  formatDate,
  formatMoney,
  formatShareCount,
  updateCompany,
  type OfferingListItem,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status } from '@components/Ledger';
import apiClient from '@services/apiClient';
import { useCompany } from '../hooks/useCompany';
import { CompanyReadNotice } from '../CompanyState';
import { useOfferingActions, useOfferings } from './useOffering';
import { OfferingReadNotice } from './OfferingReadNotice';
import { OfferingEditor } from './OfferingEditor';
import { SubscriptionsLedger } from './SubscriptionsLedger';

function OfferingRecord({
  row,
  busy,
  run,
  edit,
}: {
  row: OfferingListItem;
  busy: boolean;
  run: (action: 'submit' | 'withdraw' | 'remove', uuid: string) => void;
  edit: () => void;
}) {
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-medium text-text-primary">
          {row.tokenName} ({row.tokenSymbol})
        </h3>
        <Status
          tone={
            row.isOpen
              ? 'done'
              : row.status === 'submitted' || row.status === 'under_review' || row.status === 'approved'
                ? 'moving'
                : row.status === 'draft'
                  ? 'waiting'
                  : 'closed'
          }
        >
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
      </div>
    </li>
  );
}

export default function OfferingPage() {
  const companyRead = useCompany();
  const { company } = companyRead;
  const data = useOfferings(company?.uuid);
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ company: string; uuid?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actions = useOfferingActions(data.refresh);
  const listing = useMutation({
    mutationFn: ({ uuid, isOpen }: { uuid: string; isOpen: boolean }) =>
      updateCompany(apiClient, uuid, { isOpenToInvestors: isOpen }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['company'] }),
    onMutate: () => setActionError(null),
    onError: (error) =>
      setActionError(apiErrorSentence(error, 'Directory visibility could not be changed. Try again.')),
  });
  const busy = actions.submit.isPending || actions.withdraw.isPending || actions.remove.isPending || listing.isPending;
  const ready =
    !!company && !companyRead.error && !companyRead.isRefreshing && !data.error && !data.isRefreshing && !busy;
  const run = async (action: 'submit' | 'withdraw' | 'remove', uuid: string) => {
    const offering = data.offerings.find((row) => row.uuid === uuid);
    if (!ready || !offering) return;
    if (action === 'submit' && !offering.canBeEdited) return;
    if (action === 'remove' && !offering.canBeDeleted) return;
    if (action === 'withdraw' && !OFFERING_WITHDRAWABLE_STATUSES.includes(offering.status)) return;
    setActionError(null);
    try {
      if (action === 'withdraw') await actions.withdraw.mutateAsync({ uuid, reason: 'Withdrawn by the issuer' });
      else await actions[action].mutateAsync(uuid);
    } catch (error) {
      setActionError(apiErrorSentence(error, 'The request was refused. Please try again.'));
    }
  };
  return (
    <>
      <Page
        loading={companyRead.isLoading || data.isLoading}
        actions={
          <PageAction
            label="New offering"
            disabled={!ready || !data.tokens.some((token) => token.status === 'deployed')}
            onClick={() => {
              if (ready) setEditor({ company: company.uuid });
            }}
          />
        }
      >
        {companyRead.error ? (
          <CompanyReadNotice read={companyRead} />
        ) : !company ? (
          <p className="text-sm text-text-muted">No company found. Please register your company first.</p>
        ) : (
          <>
            <Section title="Investor Directory">
              <p className="text-sm text-text-muted">
                Your company is listed in the investor directory only while this is on. Nothing is listed by default,
                and {data.operatorName} can switch it off. Turning it off hides your share classes; it does not withdraw
                an offering already under review.
              </p>
              <label className="flex items-center gap-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={company.isOpenToInvestors}
                  disabled={!ready || !company.canIssueTokens}
                  onChange={(event) => {
                    if (ready && company.canIssueTokens)
                      listing.mutate({ uuid: company.uuid, isOpen: event.target.checked });
                  }}
                />
                Show this company to eligible investors
              </label>
              {!company.canIssueTokens && (
                <p className="text-sm text-text-muted">
                  Your company must be active before it can be listed. It is currently {company.statusDisplay}.
                </p>
              )}
            </Section>
            <CompanyReadNotice read={companyRead} />
            <OfferingReadNotice read={data} />
            {actionError && (
              <p role="alert" className="text-sm text-error-light">
                {actionError}
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
                <SubscriptionsLedger offerings={data.offerings} operatorName={data.operatorName} />
              </>
            )}
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
    </>
  );
}
