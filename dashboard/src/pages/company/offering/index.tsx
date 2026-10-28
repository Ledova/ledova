import { useEffect, useRef } from 'react';
import { generatePath, useLocation, useNavigate } from 'react-router-dom';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { offeringTone } from '@pages/company/shared/statusTones';
import { LinkRow, Outcome, Section, Status, SwitchRow } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import {
  DESTINATIONS,
  createUserFriendlyError,
  formatDate,
  formatDateTime,
  formatMoney,
  useCompanySelection,
} from '@ledova/shared';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { CompanyReadNotice } from '@components/CompanyState';
import { OfferingEditor } from './shared/OfferingEditor';
import { useCompanyOfferings } from './shared/useCompanyOfferings';

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
  const { company, data, editor, setEditor, actionError, listingPendingRef, mounted, listing, ready } =
    useCompanyOfferings({ companyRead });
  const context = useCompanyContext();
  const location = useLocation();
  const navigate = useNavigate();
  const offeringPath = (uuid: string) => {
    const path = generatePath(DESTINATIONS.companyOfferingDetail.path, { uuid });
    return context?.companyPath(path) ?? path;
  };
  const outcome = typeof location.state?.offeringOutcome === 'string' ? location.state.offeringOutcome : '';
  const listed = !companyRead.isLoading && !data.isLoading && !companyRead.error && !!company && !data.error;
  const landed = useRef<HTMLDivElement>(null);
  const focused = useRef('');
  useEffect(() => {
    if (!outcome || !listed || focused.current === location.key) return;
    focused.current = location.key;
    landed.current?.focus({ preventScroll: true });
  }, [outcome, listed, location.key]);
  const deployed = data.tokens.some((token) => token.status === 'deployed');
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
            {!data.error && (
              <>
                <Section title={`Your offerings (${data.offerings.length})`}>
                  <div ref={landed} tabIndex={outcome ? -1 : undefined} className="focus:outline-none">
                    <Outcome>{outcome}</Outcome>
                  </div>
                  {data.offerings.length === 0 ? (
                    <p className="text-sm text-text-muted">No offerings yet. Create one and submit it for review.</p>
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {data.offerings.map((row) => (
                        <li key={row.uuid}>
                          <LinkRow
                            to={offeringPath(row.uuid)}
                            label={`${row.tokenName} (${row.tokenSymbol})`}
                            context={`offering created ${formatDate(row.createdAt)}, ${row.statusDisplay.toLowerCase()}`}
                            aside={<Status tone={offeringTone(row)}>{row.statusDisplay}</Status>}
                          >
                            <span className="block text-xs text-text-muted">
                              {formatMoney(row.pricePerShare, row.priceCurrency)} per share · opens{' '}
                              <span className="whitespace-nowrap">{formatDateTime(row.opensAt)}</span>
                              {row.closesAt && (
                                <>
                                  {' '}
                                  · closes <span className="whitespace-nowrap">{formatDateTime(row.closesAt)}</span>
                                </>
                              )}
                            </span>
                          </LinkRow>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!deployed && (
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
                    disabled={!ready || !deployed}
                    onClick={() => {
                      if (ready) setEditor({ company: company.uuid });
                    }}
                  />
                </FormActions>
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
          onCreated={(uuid) => navigate(offeringPath(uuid))}
        />
      )}
    </>
  );
}
