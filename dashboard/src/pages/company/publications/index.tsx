import { Link } from 'react-router-dom';
import { DESTINATIONS, useCompanySelection } from '@ledova/shared';
import { Section, LoadError } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { Page, PageAction } from '@components/Page';
import { CompanyReadNotice } from '@pages/company/shared/CompanyState';
import { CompanySelection } from '@pages/company/shared/CompanySelection';
import { PublicationRecord } from './PublicationRecord';
import { useIssuerPublications } from './useIssuerPublications';

export default function IssuerPublicationsPage() {
  const companyRead = useCompanySelection({ ownedOnly: true });
  return (
    <CompanyPublications key={`${companyRead.scopeKey}/${companyRead.companyUuid ?? ''}`} companyRead={companyRead} />
  );
}

function CompanyPublications({ companyRead }: { companyRead: ReturnType<typeof useCompanySelection> }) {
  const { company } = companyRead;
  const { listing, publications, count, hasError, moreFailed, loadMore, open, openingUuid, openError } =
    useIssuerPublications(company?.uuid, companyRead);
  const blocked = !!companyRead.error || companyRead.isRefreshing || listing.isError || listing.isFetching;
  return (
    <Page
      narrow
      lede="Staff prepare and publish these records on your company's written instruction."
      loading={companyRead.isLoading || listing.isLoading}
      actions={
        <>
          <PageAction
            label="Refresh publications"
            onClick={() => {
              void companyRead.refetch();
              if (company) void listing.refetch();
            }}
            busy={companyRead.isRefreshing || (listing.isFetching && !listing.isFetchingNextPage)}
            busyLabel="Refreshing…"
            disabled={listing.isFetchingNextPage}
          />
        </>
      }
    >
      <CompanySelection read={companyRead} />
      {companyRead.error ? (
        <CompanyReadNotice read={companyRead} />
      ) : !company ? (
        <p className="text-sm text-text-muted">No company information available.</p>
      ) : (
        <>
          {hasError ? (
            <LoadError retry={() => listing.refetch()} busy={listing.isFetching}>
              Your company&apos;s publications could not be loaded.
            </LoadError>
          ) : (
            <>
              <CompanyReadNotice read={companyRead} />
              <Section title={count === undefined ? 'Publications' : `Publications (${count})`}>
                {listing.isFetching && !listing.isFetchingNextPage && (
                  <p role="status" className="text-sm text-text-muted">
                    Refreshing company publications…
                  </p>
                )}
                {openError && (
                  <p role="alert" className="text-sm text-error-light">
                    {openError}
                  </p>
                )}
                {!publications ? null : publications.length === 0 ? (
                  <p className="text-sm text-text-muted">No publications yet.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-border-subtle">
                      {publications.map((publication) => (
                        <li key={publication.uuid}>
                          <PublicationRecord
                            publication={publication}
                            open={() => {
                              if (!blocked) open(publication.uuid);
                            }}
                            opening={openingUuid === publication.uuid}
                            blocked={blocked}
                          />
                        </li>
                      ))}
                    </ul>
                    <LoadMore
                      noun={['publication', 'publications']}
                      hasMore={listing.hasNextPage}
                      failed={moreFailed}
                      loading={listing.isFetchingNextPage}
                      disabled={listing.isFetching}
                      onLoad={loadMore}
                    />
                    <p className="text-xs text-text-muted">
                      These are the stored documents as published. Company and share class names are frozen at
                      publication.
                    </p>
                  </>
                )}
              </Section>
            </>
          )}
          <p className="text-sm text-text-muted">
            To read notices addressed to you or vote as a member, open{' '}
            <Link to={DESTINATIONS.publications.path} className="text-brand-light underline">
              Notices
            </Link>
            .
          </p>
        </>
      )}
    </Page>
  );
}
