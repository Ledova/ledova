import { useCompanyContext } from '@hooks/useCompanyContext';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { DESTINATIONS, useCompanySelection } from '@ledova/shared';
import { Section, LoadError, Failure } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { Page } from '@components/Page';
import { CompanyReadNotice } from '@components/CompanyState';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { PublicationRecord } from './PublicationRecord';
import { useIssuerPublications } from './useIssuerPublications';

export default function IssuerPublicationsPage() {
  const [opening, setOpening] = useState<{ scope: string; company: string | undefined } | null>(null);
  const context = useCompanyContext();
  const companyRead = useCompanySelection({
    ownedOnly: true,
    coordinatedReads: true,
    pausedScope: opening?.scope,
    selectedUuid: context ? (context.companyUuid ?? '') : undefined,
  });
  return (
    <CompanyPublications
      key={`${companyRead.scopeKey}/${companyRead.companyUuid ?? ''}`}
      companyRead={companyRead}
      onOpeningChange={(busy) =>
        setOpening((current) =>
          busy
            ? { scope: companyRead.scopeKey, company: companyRead.companyUuid }
            : current?.scope === companyRead.scopeKey && current.company === companyRead.companyUuid
              ? null
              : current,
        )
      }
    />
  );
}

function CompanyPublications({
  companyRead,
  onOpeningChange,
}: {
  companyRead: ReturnType<typeof useCompanySelection>;
  onOpeningChange: (opening: boolean) => void;
}) {
  const { company } = companyRead;
  const { listing, publications, count, hasError, moreFailed, loadMore, open, openingUuid, openError } =
    useIssuerPublications(company?.uuid, companyRead, onOpeningChange);
  const blocked = !!companyRead.error || companyRead.isRefreshing || listing.isError || listing.isFetching;
  return (
    <Page
      lede="Staff prepare and publish these records on your company's written instruction."
      loading={companyRead.isLoading || listing.isLoading}
    >
      {companyRead.error ? (
        <CompanyReadNotice read={companyRead} />
      ) : !company ? (
        <CompanyContextNotice />
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
                <Failure>{openError}</Failure>
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
