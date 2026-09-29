import { Link, useNavigate } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { CompanyReadNotice } from '../CompanyState';
import { useCompany } from '../hooks/useCompany';
import { PublicationRecord } from './PublicationRecord';
import { useIssuerPublications } from './useIssuerPublications';

export default function IssuerPublicationsPage() {
  const navigate = useNavigate();
  const companyRead = useCompany();
  const { company } = companyRead;
  const { listing, open, openingUuid, openError } = useIssuerPublications(company?.uuid);
  const blocked = !!companyRead.error || companyRead.isRefreshing || listing.isError || listing.isFetching;
  return (
    <Page
      lede="Staff prepare and publish these records on your company's written instruction."
      loading={companyRead.isLoading || listing.isLoading}
      actions={
        <>
          <PageAction label="Back to Company" onClick={() => navigate(DESTINATIONS.company.path)} />
          <PageAction
            label="Refresh"
            onClick={() => {
              void companyRead.refetch();
              if (company) void listing.refetch();
            }}
            disabled={companyRead.isRefreshing || listing.isFetching}
          />
        </>
      }
    >
      {companyRead.error ? (
        <CompanyReadNotice read={companyRead} />
      ) : !company ? (
        <p className="text-sm text-text-muted">No company information available.</p>
      ) : (
        <>
          {listing.isError ? (
            <div role="alert" className="space-y-2 text-sm text-text-muted">
              <p>Your company&apos;s publications could not be loaded. Try again before continuing.</p>
              <PageAction
                label="Retry publications"
                onClick={() => void listing.refetch()}
                disabled={listing.isFetching}
              />
            </div>
          ) : (
            <>
              <CompanyReadNotice read={companyRead} />
              {listing.isFetching && (
                <p role="status" className="text-sm text-text-muted">
                  Refreshing company publications…
                </p>
              )}
              {openError && (
                <p role="alert" className="text-sm text-error-light">
                  {openError}
                </p>
              )}
              {listing.data?.length === 0 ? (
                <p className="text-sm text-text-muted">
                  Nothing has been published to this company&apos;s members yet.
                </p>
              ) : (
                <>
                  <p className="text-sm text-text-muted">
                    {listing.data?.length} publication{listing.data?.length === 1 ? '' : 's'}
                  </p>
                  {listing.data?.map((publication) => (
                    <PublicationRecord
                      key={publication.uuid}
                      publication={publication}
                      open={() => {
                        if (!blocked) open(publication.uuid);
                      }}
                      opening={openingUuid === publication.uuid}
                      blocked={blocked}
                    />
                  ))}
                  <p className="text-xs text-text-muted">
                    These are the stored documents as published. Company and share class names are frozen at
                    publication.
                  </p>
                </>
              )}
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
