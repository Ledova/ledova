import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  OFFERING_EXEMPTION_LABELS,
  OFFERING_PUBLISHED_STATUSES,
  OFFERING_WITHDRAWABLE_STATUSES,
  OFFER_DOCUMENT_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  formatDate,
  formatMoney,
  formatShareCount,
  updateCompany,
  type OfferingListItem,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status, SwitchRow } from '@components/Ledger';
import apiClient from '@services/apiClient';
import { useCompany } from '../hooks/useCompany';
import { CompanySelection } from '../CompanySelection';
import { CompanyReadNotice } from '../CompanyState';
import { useOfferingActions, useOfferings } from './useOffering';
import { OfferingReadNotice } from './OfferingReadNotice';
import { OfferingDocumentsEditor } from './OfferingDocumentsEditor';
import { OfferingEditor } from './OfferingEditor';
import { SubscriptionsLedger } from './SubscriptionsLedger';

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
        {OFFERING_PUBLISHED_STATUSES.includes(row.status) && (
          <PageAction label={OFFER_DOCUMENT_COPY.ADD} disabled={busy} onClick={addDocuments} />
        )}
      </div>
    </li>
  );
}

export default function OfferingPage() {
  const companyRead = useCompany({ ownedOnly: true });
  return (
    <CompanyOfferings key={`${companyRead.scopeKey}/${companyRead.companyUuid ?? ''}`} companyRead={companyRead} />
  );
}

function CompanyOfferings({ companyRead }: { companyRead: ReturnType<typeof useCompany> }) {
  const { company } = companyRead;
  const data = useOfferings(companyRead.retainedCompany?.uuid, companyRead);
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ company: string; uuid?: string } | null>(null);
  const [documentsEditor, setDocumentsEditor] = useState<{ company: string; uuid: string } | null>(null);
  const [actionError, setActionError] = useState<{ listing: boolean; message: string } | null>(null);
  const listingPending = useRef(false);
  const actionPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ownerGuard = () => {
    if (!mounted.current || !company) throw createUserFriendlyError('This company action is closed.');
    companyRead.assertCurrent(company.uuid, 'owner');
  };
  const actions = useOfferingActions(
    async () => {
      ownerGuard();
      await data.refresh();
      ownerGuard();
    },
    (uuid, action) => {
      const guard = () => {
        ownerGuard();
        data.assertOffering(uuid, action);
      };
      return { ...companyRead.requestConfig(company!.uuid, 'owner'), ledovaSubmissionGuard: guard };
    },
  );
  const listing = useMutation({
    mutationFn: async ({
      uuid,
      isOpen,
      guard,
      config,
    }: {
      uuid: string;
      isOpen: boolean;
      guard: () => void;
      config: ReturnType<typeof companyRead.requestConfig>;
    }) => {
      guard();
      const result = await updateCompany(apiClient, uuid, { isOpenToInvestors: isOpen }, config);
      guard();
      if (
        result.data.uuid !== uuid ||
        result.data.isOpenToInvestors !== isOpen ||
        !Array.isArray(result.data.documents)
      )
        throw createUserFriendlyError('Directory visibility could not be confirmed. Refresh before retrying.');
      return result;
    },
    onSuccess: async (_, { guard }) => {
      guard();
      await client.invalidateQueries({ queryKey: companyRead.companyKey });
    },
    onSettled: () => {
      listingPending.current = false;
    },
    onMutate: () => setActionError(null),
    onError: (error) =>
      setActionError({
        listing: true,
        message: apiErrorSentence(
          error,
          'Directory visibility could not be changed. Try again.',
          'Directory visibility could not be confirmed. Refresh before retrying.',
        ),
      }),
  });
  const busy = actions.submit.isPending || actions.withdraw.isPending || actions.remove.isPending || listing.isPending;
  const ready =
    !!company && !companyRead.error && !companyRead.isRefreshing && !data.error && !data.isRefreshing && !busy;
  const run = async (action: 'submit' | 'withdraw' | 'remove', uuid: string) => {
    const offering = data.offerings.find((row) => row.uuid === uuid);
    if (!ready || !offering || actionPending.current) return;
    if (action === 'submit' && !offering.canBeEdited) return;
    if (action === 'remove' && !offering.canBeDeleted) return;
    if (action === 'withdraw' && !OFFERING_WITHDRAWABLE_STATUSES.includes(offering.status)) return;
    setActionError(null);
    actionPending.current = true;
    try {
      ownerGuard();
      if (action === 'withdraw') await actions.withdraw.mutateAsync({ uuid, reason: 'Withdrawn by the issuer' });
      else await actions[action].mutateAsync(uuid);
    } catch (error) {
      setActionError({
        listing: false,
        message: apiErrorSentence(error, 'The request could not be completed. Try again.'),
      });
    } finally {
      actionPending.current = false;
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
        <CompanySelection read={companyRead} />
        {companyRead.error ? (
          <CompanyReadNotice read={companyRead} />
        ) : !company ? (
          <p className="text-sm text-text-muted">No company found. Please register your company first.</p>
        ) : (
          <>
            <CompanyReadNotice read={companyRead} />
            <OfferingReadNotice read={data} />
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
                and {data.operatorName} can switch it off. Turning it off hides your share classes; it does not withdraw
                an offering already under review.
              </p>
              <SwitchRow
                label="Show this company to eligible investors"
                checked={company.isOpenToInvestors ?? false}
                disabled={!ready || !company.canIssueTokens || !companyRead.canAdmin}
                onChange={(isOpen) => {
                  if (ready && company.canIssueTokens && companyRead.canAdmin && !listingPending.current) {
                    const uuid = company.uuid;
                    const assertCurrent = companyRead.assertCurrent;
                    const guard = () => {
                      if (!mounted.current) throw createUserFriendlyError('This company action is closed.');
                      assertCurrent(uuid);
                    };
                    listingPending.current = true;
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
