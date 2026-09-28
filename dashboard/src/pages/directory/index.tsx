import { DESTINATIONS, formatDate, formatMoney, useDirectoryTokens } from '@ledova/shared';
import type { DirectoryToken } from '@ledova/shared';
import { LinkRow, Section, Status } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';

function ShareClassRow({ token }: { token: DirectoryToken }) {
  const offering = token.openOffering;
  return (
    <LinkRow
      to={DESTINATIONS.directoryDetail.path.replace(':uuid', token.uuid)}
      label={token.name}
      aside={
        offering && (
          <div className="min-w-0 text-right">
            <p className="break-all tabular-nums text-text-primary">
              {formatMoney(offering.pricePerShare, offering.priceCurrency)} per share
            </p>
            <p className="text-text-muted">
              {offering.closesAt ? `Closes ${formatDate(offering.closesAt)}` : 'No closing date'}
            </p>
          </div>
        )
      }
    >
      <p className="text-text-muted">{token.symbol}</p>
      <p className="text-text-muted">
        <Status tone={offering ? 'moving' : 'waiting'}>{offering ? 'Offering open' : 'No offering open'}</Status>
      </p>
    </LinkRow>
  );
}

export default function DirectoryPage() {
  const { tokens, isEligible, isLoading, hasError, isRefreshing, retry } = useDirectoryTokens();

  if (isLoading) return <Page loading />;

  if (hasError) {
    return (
      <Page>
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">The directory could not be loaded. Try again before continuing.</p>
          <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
        </div>
      </Page>
    );
  }

  if (!isEligible) {
    return (
      <Page>
        <Section title="Verify your investor status">
          <p className="py-2 text-sm text-text-muted">
            The directory shows share classes available to eligible investors. Submit your evidence for the operator to
            review.
          </p>
          <LinkRow to={DESTINATIONS.investorEligibility.path} label={DESTINATIONS.investorEligibility.title} />
        </Section>
      </Page>
    );
  }

  const issuers = new Map<string, DirectoryToken[]>();
  for (const token of tokens) issuers.set(token.companyUuid, [...(issuers.get(token.companyUuid) ?? []), token]);

  return (
    <Page>
      <p className="text-sm text-text-muted">Share classes and current offerings available to you.</p>
      {tokens.length === 0 ? (
        <Section title="Share classes">
          <p className="py-3 text-sm text-text-muted">No share classes available.</p>
        </Section>
      ) : (
        [...issuers.entries()].map(([uuid, classes]) => {
          const company = classes[0].company;
          return (
            <div key={uuid} className="min-w-0 break-words">
              <Section title={company.displayName}>
                {[company.industry, company.city, company.state].some(Boolean) && (
                  <p className="text-sm text-text-muted">
                    {[company.industry, company.city, company.state].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="divide-y divide-border-subtle">
                  {classes.map((token) => (
                    <ShareClassRow key={token.uuid} token={token} />
                  ))}
                </div>
              </Section>
            </div>
          );
        })
      )}
    </Page>
  );
}
