import { DIRECTORY_OFFERING_TONES } from '@pages/directory/shared/presentation';
import { generatePath } from 'react-router-dom';
import { DESTINATIONS, formatMoney, useDirectoryTokens, formatDateTime } from '@ledova/shared';
import type { DirectoryToken } from '@ledova/shared';
import { LinkRow, Section, Status, LoadError } from '@components/Ledger';
import { Page } from '@components/Page';

function ShareClassRow({ token }: { token: DirectoryToken }) {
  const offering = token.openOffering;
  return (
    <LinkRow
      to={generatePath(DESTINATIONS.directoryDetail.path, { uuid: token.uuid })}
      label={token.name}
      aside={
        offering && (
          <div className="min-w-0 text-right">
            <p className="break-all tabular-nums text-text-primary">
              {formatMoney(offering.pricePerShare, offering.priceCurrency)} per share
            </p>
            <p className="text-text-muted">
              {offering.closesAt ? `Closes ${formatDateTime(offering.closesAt)}` : 'No closing date'}
            </p>
          </div>
        )
      }
    >
      <p className="text-text-muted">{token.symbol}</p>
      <p className="text-text-muted">
        <Status tone={DIRECTORY_OFFERING_TONES.get(!!offering)!}>
          {offering ? 'Offering open' : 'No offering open'}
        </Status>
      </p>
    </LinkRow>
  );
}

export default function DirectoryPage() {
  const { tokens, isReady, isLoading, hasError, isRefreshing, retry } = useDirectoryTokens();

  if (isLoading) return <Page narrow loading />;

  if (hasError) {
    return (
      <Page narrow>
        <LoadError retry={retry} busy={isRefreshing}>
          The directory could not be loaded.
        </LoadError>
      </Page>
    );
  }

  if (!isReady) {
    return (
      <Page narrow>
        <Section title="Check your investor account">
          <p className="py-2 text-sm text-text-muted">
            Account and identity checks are prerequisites. Each company separately decides eligibility for its
            offerings.
          </p>
          <LinkRow to={DESTINATIONS.investorEligibility.path} label={DESTINATIONS.investorEligibility.title} />
          <LinkRow to={DESTINATIONS.eligibilityRequests.path} label={DESTINATIONS.eligibilityRequests.title} />
        </Section>
      </Page>
    );
  }

  const issuers = new Map<string, DirectoryToken[]>();
  for (const token of tokens) issuers.set(token.companyUuid, [...(issuers.get(token.companyUuid) ?? []), token]);

  return (
    <Page narrow>
      {tokens.length === 0 ? (
        <Section title="Share classes">
          <p className="py-3 text-sm text-text-muted">
            No share classes available under your current company decisions.
          </p>
          <p className="text-sm text-text-muted">
            Use the company or offering UUID supplied to you to request eligibility.
          </p>
          <LinkRow to={DESTINATIONS.eligibilityRequests.path} label={DESTINATIONS.eligibilityRequests.title} />
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
