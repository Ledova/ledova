import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { PUBLICATION_COPY, PUBLICATION_KIND_LABELS, formatDate, formatShareCount } from '@ledova/shared';
import type { BallotChoice, Publication } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, LoadError } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { Distribution } from './Distribution';
import { Resolution } from './Resolution';
import { usePublications } from './usePublications';

function PublicationRow({
  publication,
  onOpen,
  isOpening,
  onCast,
  isCasting,
  castError,
}: {
  publication: Publication;
  onOpen: (uuid: string) => void;
  isOpening: boolean;
  onCast: (uuid: string, choice: BallotChoice) => void;
  isCasting: boolean;
  castError: string | undefined;
}) {
  return (
    <article className="min-w-0 break-words">
      <Section title={publication.title}>
        <div className="flex flex-wrap items-start justify-between gap-4 py-2">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-xs uppercase tracking-wide text-text-muted">
              {PUBLICATION_KIND_LABELS[publication.kind]}
            </p>
            <p className="mt-1 text-sm text-text-primary">{publication.companyName}</p>
            <p className="text-sm text-text-muted">
              {publication.tokenName} ({publication.tokenSymbol})
            </p>
          </div>
          <PageAction
            icon={<ArrowSquareOutIcon size={16} />}
            label={PUBLICATION_COPY.OPEN}
            busy={isOpening}
            busyLabel={PUBLICATION_COPY.OPENING}
            onClick={() => onOpen(publication.uuid)}
          />
        </div>
        <Rows>
          <Row label={PUBLICATION_COPY.RECORD_DATE_LABEL}>{formatDate(publication.recordDate)}</Row>
        </Rows>
        {publication.shares !== null && publication.shares !== undefined && (
          <div className="py-2">
            <p className="text-sm text-text-muted">
              {publication.kind === 'resolution'
                ? PUBLICATION_COPY.VOTING_WEIGHT_LABEL
                : PUBLICATION_COPY.HOLDING_LABEL}
            </p>
            <p className="break-all text-lg tabular-nums text-text-primary">{formatShareCount(publication.shares)}</p>
          </div>
        )}
        <Resolution publication={publication} onCast={onCast} isCasting={isCasting} castError={castError} />
        <Distribution publication={publication} />
      </Section>
    </article>
  );
}

export default function PublicationsPage() {
  const {
    publications,
    isLoading,
    listFailed,
    moreFailed,
    isRefreshing,
    retry,
    hasMore,
    isLoadingMore,
    loadMore,
    open,
    openingUuid,
    openError,
    cast,
    castingUuid,
    castError,
  } = usePublications();

  if (isLoading) return <Page narrow loading />;

  return (
    <Page narrow>
      {openError && (
        <p role="alert" className="text-sm text-error-light">
          {openError}
        </p>
      )}
      {listFailed ? (
        <LoadError retry={retry} busy={isRefreshing}>
          {publications.length ? 'Your notices could not be refreshed.' : PUBLICATION_COPY.LIST_FAILED}
        </LoadError>
      ) : (
        <>
          {publications.length === 0 && !hasMore && !moreFailed ? (
            <Section title="Your notices">
              <p className="py-3 text-sm text-text-muted">{PUBLICATION_COPY.EMPTY}</p>
            </Section>
          ) : (
            publications.map((publication) => (
              <PublicationRow
                key={publication.uuid}
                publication={publication}
                onOpen={open}
                isOpening={openingUuid === publication.uuid}
                onCast={cast}
                isCasting={castingUuid === publication.uuid}
                castError={castError?.uuid === publication.uuid ? castError.message : undefined}
              />
            ))
          )}
          <LoadMore
            noun={['notice', 'notices']}
            hasMore={hasMore}
            failed={moreFailed}
            loading={isLoadingMore}
            disabled={isRefreshing}
            onLoad={loadMore}
          />
          {publications.length > 0 && <p className="text-xs text-text-muted">{PUBLICATION_COPY.FROZEN_HELP}</p>}
        </>
      )}
    </Page>
  );
}
